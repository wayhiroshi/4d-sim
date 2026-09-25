import { planConfig } from "./plan";
import { applyPlacementOverrides } from "./strategy-placement";
import { computeRawBonus, descendants, evaluateTitle, evaluateTitleChecklists, evaluateTrainerQualificationChecklists, groupPv, groupPvThroughDepth, indexMonth, isActive, nextPeriod, ownedIds, previousPeriod, settleBonus } from "./engine";
import { TITLE_ORDER, type Member, type OrganizationSnapshot, type PurchaseEvent, type TaxProfile, type TitleCode } from "../shared/types";
import { CHECKPOINTS, STRATEGY_VERSION, blankMember, type Band, type IdIncome, type LeaderGrowthProfile, type Objective, type StrategyCandidate, type StrategyMonth, type StrategyNode, type StrategySimulationRequest, type StrategySimulationResult, type StrategyVariantResult } from "../shared/strategy";

const zeroTax: TaxProfile = { invoiceRegistered: true, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 };
const rank = (title: TitleCode) => TITLE_ORDER.indexOf(title);
const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const alive = (m: Member, period: string) => m.joinedPeriod <= period && (!m.endedPeriod || m.endedPeriod > period);
export function inputFingerprint(base: OrganizationSnapshot, input: StrategySimulationRequest): string {
  // Reproducibility marker; not used for authentication or integrity decisions.
  const text = JSON.stringify({ base, input, version: STRATEGY_VERSION, plan: planConfig.version });
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

export function validateStrategyBase(base: OrganizationSnapshot, request: StrategySimulationRequest): void {
  const byId = new Map(base.members.map((m) => [m.id, m]));
  if (byId.size !== base.members.length) throw new Error("出発点に重複IDがあります");
  const root = byId.get(request.rootId);
  if (!root || root.idKind !== "master" || !alive(root, base.period)) throw new Error("有効なメインIDを指定してください");
  const owners = [request.rootId, ...(request.partnerId ? [request.partnerId] : [])];
  for (const owner of owners) if (byId.get(owner)?.idKind !== "master") throw new Error("所有者はメインIDを選択してください");
  const household = new Set(base.members.filter((m) => owners.includes(m.id) || owners.includes(m.masterMemberId ?? "")).map((m) => m.id));
  if (!household.has(request.targetId)) throw new Error("目標IDは自分・パートナー・所有サブから選択してください");
  if (!alive(byId.get(request.targetId)!, base.period)) throw new Error("目標IDは出発点の営業月で在籍しているIDを選択してください");
  for (const m of base.members) {
    const seen = new Set([m.id]); let parent = m.parentMemberId;
    while (parent) {
      if (seen.has(parent)) throw new Error("組織に循環があります");
      if (!byId.has(parent)) throw new Error("配置親が存在しません");
      seen.add(parent); parent = byId.get(parent)!.parentMemberId;
    }
  }
  const inScope = new Set([request.rootId, ...descendants(base, request.rootId).map((d) => d.member.id)]);
  if (request.partnerId && !inScope.has(request.partnerId)) throw new Error("パートナーは今回の組織内のメインIDを指定してください");
  const known = new Set([...byId.keys(), ...request.leaders.filter(l => !l.existingMemberId).map(l => `strategy-${l.id}`), ...request.actions.filter((a) => a.kind === "create-sub").map((a) => a.memberId)]);
  for (const l of request.leaders) {
    if (l.existingMemberId && !byId.has(l.existingMemberId)) throw new Error("リーダーが出発点に存在しません");
    if (!known.has(l.placementId) || !byId.has(l.introducerId)) throw new Error("リーダーの配置親・紹介者が存在しません");
    if (l.existingMemberId && !inScope.has(l.existingMemberId)) throw new Error("リーダーは今回の組織内から選択してください");
    if (byId.has(l.placementId) && !inScope.has(l.placementId)) throw new Error("配置先は今回の組織内から選択してください");
    if (!l.existingMemberId && byId.has(`strategy-${l.id}`)) throw new Error("新規リーダーの試算IDが既存IDと重複しています");
  }
  if (new Set(request.actions.map((a) => a.id)).size !== request.actions.length) throw new Error("操作IDが重複しています");
  if (base.members.length > 5000) throw new Error("出発点は5,000 ID以内にしてください");
  if (request.placementMode === "manual" || Object.keys(request.placementOverrides ?? {}).length) applyPlacementOverrides(base, request);
}

/** Calculate every downline title before its upline. Credentials survive a bad month;
 * payout titles never reuse a stale downline title. The supplied snapshot is cloned. */
export function evaluateStrategyMonth(base: OrganizationSnapshot, request: StrategySimulationRequest, month: number, acquired: Map<string, TitleCode>, carries: Map<string, number>, priorDirectorPv?: Map<string, number>) {
  const snapshot = indexMonth({ ...base, members: base.members.filter((m) => m.joinedPeriod <= base.period).map((m) => ({ ...m })) }, { priorDirectorPv, compressionEnabled: request.provisionalCompression });
  let missing: string[] = [];
  const children = new Map<string, Member[]>();
  for (const m of snapshot.members) if (m.parentMemberId) children.set(m.parentMemberId, [...(children.get(m.parentMemberId) ?? []), m]);
  const order: Member[] = []; const visited = new Set<string>();
  const visit = (m: Member) => { if (visited.has(m.id)) return; visited.add(m.id); for (const child of children.get(m.id) ?? []) visit(child); order.push(m); };
  snapshot.members.filter((m) => m.parentMemberId === null).forEach(visit);
  for (const m of order) {
    if (!alive(m, snapshot.period)) { m.title = "NONE"; continue; }
    const historical = acquired.get(m.id) ?? m.title;
    m.title = historical;
    if (m.id === request.targetId) missing = (evaluateTitleChecklists(snapshot, m.id).find((c) => c.code === request.targetTitle)?.conditions ?? [])
      .filter((c) => !c.met).map((c) => `${c.label}：${c.current} / ${c.required}`);
    // A never-DR leaf cannot meet LD's required first/second lines, nor any
    // higher acquisition condition. Historical DRs still need maintenance.
    const evaluated = !children.has(m.id) && rank(historical) < rank("DR") ? "NONE" : evaluateTitle(snapshot, m.id).achievedTitle;
    if (rank(evaluated) > rank(historical)) acquired.set(m.id, evaluated);
    else acquired.set(m.id, historical);
    if (rank(evaluated) >= rank("DR") && rank(historical) < rank("DR")) m.directorPromotedPeriod = snapshot.period;
    m.title = evaluated;
    if (!m.sponsorLicense || (!m.preTrainerCourseCompleted && !m.startTrainerCourseCompleted)) continue;
    for (const credential of ["PT", "ST"] as const) {
      if (m.trainerCredential === "ST" || m.trainerCredential === credential) continue;
      const check = evaluateTrainerQualificationChecklists(snapshot, m.id).find((c) => c.code === credential);
      if (check?.conditions.every((c) => c.met)) m.trainerCredential = credential;
    }
  }
  const owners = [request.rootId, ...(request.partnerId ? [request.partnerId] : [])];
  const ids: IdIncome[] = [];
  const payees: StrategyMonth["payees"] = [];
  let recurringNet = 0;
  const included = new Set<string>();
  for (const owner of owners) {
    const raw = { start: 0, trainer: 0, line: 0, director: 0, title: 0, gross: 0 };
    for (const member of ownedIds(snapshot, owner).filter((m) => alive(m, snapshot.period))) {
      if (included.has(member.id)) continue;
      included.add(member.id);
      const payoutTitle = member.title;
      const bonus = computeRawBonus(snapshot, member.id, payoutTitle);
      for (const key of Object.keys(raw) as Array<keyof typeof raw>) raw[key] += bonus[key];
      ids.push({ id: member.id, name: member.displayName, ownerId: owner, title: payoutTitle, acquiredTitle: acquired.get(member.id) ?? payoutTitle,
        trainer: member.trainerCredential, start: bonus.start, trainerBonus: bonus.trainer, line: bonus.line, director: bonus.director,
        titleBonus: bonus.title, gross: bonus.gross, recurring: bonus.line + bonus.director + bonus.title,
        cost: (isActive(snapshot, member.id) ? (request.ownedMonthlyCosts[member.id] ?? request.courseMonthlyCosts[member.course]) : 0) +
          snapshot.purchases.filter((p) => p.memberId === member.id && p.period === snapshot.period && p.kind === "initial" && p.status === "confirmed").reduce((sum, p) => sum + p.price * p.quantity, 0) });
    }
    const tax = request.taxes[owner] ?? zeroTax;
    // A separate counterfactual: exclude initial/trainer income and historical
    // carryover, while retaining this payee's actual deductions and threshold.
    recurringNet += settleBonus({ ...raw, start: 0, trainer: 0, gross: raw.line + raw.director + raw.title }, snapshot.period, { ...tax, priorCarryover: 0 }).estimatedNet;
    const bonus = settleBonus(raw, snapshot.period, { ...tax, priorCarryover: carries.get(owner) ?? tax.priorCarryover });
    carries.set(owner, bonus.carryover);
    payees.push({ id: owner, bonus });
  }
  const downline = descendants(snapshot, request.rootId);
  const count = downline.filter(({ member }) => isActive(snapshot, member.id)).length;
  const target = snapshot.members.find((m) => m.id === request.targetId)!;
  const title = target.title;
  const net = payees.reduce((s, p) => s + p.bonus.estimatedNet, 0);
  const costs = ids.reduce((s, p) => s + p.cost, 0);
  const row: StrategyMonth = { month, period: snapshot.period, count, enrolled: downline.length, inactive: downline.length - count,
    exited: snapshot.members.filter((m) => m.endedPeriod && m.endedPeriod <= snapshot.period).length,
    ownedSubs: ids.filter((m) => m.id !== m.ownerId).length, pv: groupPv(snapshot, request.rootId), targetTitle: title,
    missing,
    gross: ids.reduce((s, m) => s + m.gross, 0), recurring: ids.reduce((s, m) => s + m.recurring, 0), recurringNet, recurringCashflow: recurringNet - costs, line: ids.reduce((s, m) => s + m.line, 0),
    net, costs, cashflow: net - costs, cumulative: 0, ids, payees, changes: [] };
  return { snapshot, row };
}

type Person = { member: Member; profileId: string | null; joinedMonth: number; active: boolean; exited: boolean; introductions: number; credit: number };
const profileMemberId = (l: LeaderGrowthProfile) => l.existingMemberId ?? `strategy-${l.id}`;
const phaseAt = (l: LeaderGrowthProfile, month: number) => l.phases.find((p) => p.fromMonth <= month && (p.toMonth === null || p.toMonth >= month));

export function candidateStrategies(base: OrganizationSnapshot, request: StrategySimulationRequest): StrategyCandidate[] {
  const owners = [request.rootId, ...(request.partnerId ? [request.partnerId] : [])];
  const anchors = base.members.filter((m) => alive(m, base.period) && (owners.includes(m.id) || owners.includes(m.masterMemberId ?? ""))).map((m) => m.id).sort();
  const fresh = request.leaders.filter((l) => !l.existingMemberId);
  const introducers = Object.fromEntries(fresh.map((l) => [l.id, l.introducerId]));
  const directPlacements = Object.fromEntries(request.leaders.filter((l) => l.existingMemberId).map((l) => [l.id, [l.placementId]]));
  const candidates: StrategyCandidate[] = [{ id: "manual", label: "手動配置", placements: Object.fromEntries(fresh.map((l) => [l.id, l.placementId])), introducers, directPlacements, actions: request.actions }];
  if (request.placementMode === "manual") return candidates;
  // Bounded deterministic beam over leader anchors. Detailed member placement
  // is replayed, never resampled, for each retained candidate and growth band.
  let beam: Array<Record<string, string>> = [{}];
  for (const leader of fresh) {
    const choices = [...new Set([leader.placementId, request.rootId, ...anchors])].slice(0, 8);
    const expanded = beam.flatMap((state) => choices.map((anchor) => ({ ...state, [leader.id]: anchor })));
    expanded.sort((a, b) => {
      const balance = (x: Record<string, string>) => Math.max(...Object.values(x).map((v) => Object.values(x).filter((a) => a === v).length));
      return balance(a) - balance(b) || stableCompare(JSON.stringify(a), JSON.stringify(b));
    });
    beam = expanded.slice(0, 24);
  }
  beam.forEach((placements, i) => {
    const selectedIntroducers = { ...introducers };
    if (request.allowIntroducerIdChoice) for (const l of fresh) {
      const source = base.members.find((m) => m.id === l.introducerId), target = base.members.find((m) => m.id === placements[l.id]);
      if (source && target && (source.masterMemberId ?? source.id) === (target.masterMemberId ?? target.id)) selectedIntroducers[l.id] = target.id;
    }
    candidates.push({ id: `placement-${i}`, label: `配置候補 ${i + 1}`, placements, introducers: selectedIntroducers, directPlacements, actions: request.actions });
  });
  if (request.allowSubCreation && fresh.length) for (const owner of owners) {
    const existingCount = base.members.filter((m) => m.masterMemberId === owner && m.idKind === "sub" && alive(m, base.period)).length;
    const count = Math.min(3, planConfig.maxSubIdsPerMaster - existingCount, fresh.length);
    if (count <= 0) continue;
    const effective = descendants(indexMonth({ ...base }, { compressionEnabled: request.provisionalCompression }), owner).filter((d) => d.depth === 1).length;
    if (effective + count > planConfig.firstLineLimit) continue;
    const actions = [...request.actions]; const placements: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      const id = `strategy-sub-${owner}-${i}`;
      actions.push({ id: `create-${id}`, kind: "create-sub", month: 1, memberId: id, parentId: owner, ownerId: owner, course: "G", requiredMemberId: null, requiredTitle: "NONE", sponsorLicense: false, trainerCredential: "NONE", studioAttendances: 0, courseCompleted: false, kitPurchased: false });
    }
    fresh.forEach((l, i) => placements[l.id] = `strategy-sub-${owner}-${i % count}`);
    const selectedIntroducers = { ...introducers };
    if (request.allowIntroducerIdChoice) for (const l of fresh) {
      const source = base.members.find((m) => m.id === l.introducerId);
      if (source && (source.masterMemberId ?? source.id) === owner) selectedIntroducers[l.id] = placements[l.id]!;
    }
    const directTargets = { ...directPlacements };
    for (const l of request.leaders.filter((l) => l.existingMemberId)) {
      const source = base.members.find((m) => m.id === l.existingMemberId);
      if (source && (source.masterMemberId ?? source.id) === owner) directTargets[l.id] = [owner, ...Array.from({ length: count }, (_, i) => `strategy-sub-${owner}-${i}`)];
    }
    candidates.push({ id: `subs-${owner}`, label: `${base.members.find((m) => m.id === owner)?.displayName ?? owner}のサブを育成`, actions, placements, introducers: selectedIntroducers, directPlacements: directTargets });
  }
  if (request.allowSubDeletion && request.provisionalCompression) {
    const deletable = base.members.filter((m) => m.idKind === "sub" && owners.includes(m.masterMemberId ?? "") && m.id !== request.targetId);
    for (const sub of deletable.slice(0, 5)) {
      const child = base.members.find((m) => m.parentMemberId === sub.id);
      if (!child) continue;
      candidates.push({ ...candidates[0]!, id: `compress-${sub.id}`, label: `${sub.displayName}の配下DR取得後に繰上げ`, actions: [...request.actions,
        { id: `delete-${sub.id}`, kind: "delete-sub", month: 1, memberId: sub.id, parentId: null, ownerId: sub.masterMemberId, course: sub.course, requiredMemberId: child.id, requiredTitle: "DR", sponsorLicense: false, trainerCredential: "NONE", studioAttendances: 0, courseCompleted: false, kitPurchased: false }] });
    }
  }
  return candidates.filter((c, i, a) => a.findIndex((x) => JSON.stringify([x.placements, x.introducers, x.directPlacements, x.actions]) === JSON.stringify([c.placements, c.introducers, c.directPlacements, c.actions])) === i);
}

function placementIndex(members: Member[], period: string, reserved = new Map<string, number>()) {
  const children = new Map<string, string[]>();
  const live = new Set(members.filter((m) => alive(m, period)).map((m) => m.id));
  for (const m of members) if (m.parentMemberId && live.has(m.id)) children.set(m.parentMemberId, [...(children.get(m.parentMemberId) ?? []), m.id]);
  return {
    add(member: Member) { live.add(member.id); if (member.parentMemberId) { const siblings = children.get(member.parentMemberId) ?? []; siblings.push(member.id); children.set(member.parentMemberId, siblings); } },
    slot(wanted: string): string | null {
      if (!live.has(wanted)) return null;
      const queue = [wanted]; const seen = new Set<string>();
      for (let i = 0; i < queue.length; i++) {
        const parent = queue[i]!; if (seen.has(parent)) continue; seen.add(parent);
        const childrenIds = children.get(parent) ?? [];
        if (childrenIds.length + (reserved.get(parent) ?? 0) < planConfig.firstLineLimit) return parent;
        queue.push(...childrenIds);
      }
      return null;
    }
  };
}
const placementSlot = (members: Member[], wanted: string, period: string) => placementIndex(members, period).slot(wanted);

export function summarizeOrganization(snapshot: OrganizationSnapshot, rootId: string, keyIds: Set<string>): StrategyNode[] {
  const all = [{ member: snapshot.members.find((m) => m.id === rootId)!, depth: 0 }, ...descendants(snapshot, rootId)];
  const nodes: StrategyNode[] = [];
  for (const { member: m, depth } of all) {
    if (!m || (!keyIds.has(m.id) && depth > 1)) continue;
    const team = descendants(snapshot, m.id);
    nodes.push({ id: m.id, name: m.displayName, parentId: m.parentMemberId, introducerId: m.introducerMemberId, ownerId: m.masterMemberId,
      course: m.course, title: m.title, count: team.length, active: team.filter((p) => isActive(snapshot, p.member.id)).length, depth });
  }
  return nodes;
}

export function* simulateStrategy(base: OrganizationSnapshot, request: StrategySimulationRequest, candidate: StrategyCandidate, band: Band, growthBase = base): Generator<number, StrategyVariantResult> {
  validateStrategyBase(base, request);
  const owners = [request.rootId, ...(request.partnerId ? [request.partnerId] : [])];
  const acquired = new Map(base.members.map((m) => [m.id, m.title])); const carries = new Map<string, number>();
  let snapshot = structuredClone(base);
  const people: Person[] = base.members.map((member) => ({ member: { ...member }, profileId: null, joinedMonth: 0,
    active: isActive(base, member.id), exited: !alive(member, base.period), introductions: base.members.filter((m) => m.introducerMemberId === member.id && m.idKind !== "sub").length, credit: 0 }));
  if (request.provisionalCompression) {
    const byId = new Map(people.map((p) => [p.member.id, p]));
    for (const p of people) {
      let parent = p.member.parentMemberId ? byId.get(p.member.parentMemberId) : undefined;
      while (parent?.exited && parent.member.idKind === "sub") {
        p.member.parentMemberId = parent.member.parentMemberId;
        parent = parent.member.parentMemberId ? byId.get(parent.member.parentMemberId) : undefined;
      }
    }
  }
  const profiles = new Map(request.leaders.map((l) => [l.id, l]));
  const existingProfiles = new Map(request.leaders.filter((l) => l.existingMemberId).map((l) => [l.existingMemberId!, l.id]));
  // Placement edits must not transfer a person's recruitment/retention profile.
  const existingById = new Map(growthBase.members.map((m) => [m.id, m]));
  for (const p of people) {
    let cursor = existingById.get(p.member.id);
    while (cursor) {
      const profileId = existingProfiles.get(cursor.id);
      if (profileId) { p.profileId = profileId; break; }
      cursor = cursor.parentMemberId ? existingById.get(cursor.parentMemberId) : undefined;
    }
  }
  const baselineOwned = new Set(base.members.filter((m) => owners.includes(m.id) || owners.includes(m.masterMemberId ?? "")).map((m) => m.id));
  // Allocate the 2,000-ID endpoint before advancing any month. Checkpoints and
  // scenario bands consume these same team quotas; they never re-optimize them.
  const initialCounts = new Map(request.leaders.map((l) => [l.id, people.filter((p) => p.profileId === l.id && !p.exited && p.member.id !== request.rootId).length]));
  const plannedSubs = candidate.actions.filter((a) => a.kind === "create-sub").length;
  const removedSubs = candidate.actions.filter((a) => a.kind === "delete-sub" && people.some((p) => p.member.id === a.memberId && !p.exited && !p.profileId)).length;
  const fixedMembers = Math.max(0, people.filter((p) => !p.profileId && !p.exited && p.active && p.member.id !== request.rootId).length + plannedSubs - removedSubs);
  const freeSlots = Math.max(0, request.targetIds - fixedMembers - [...initialCounts.values()].reduce((a, b) => a + b, 0));
  const totalWeight = request.leaders.reduce((s, l) => s + l.targetWeight, 0);
  const quotas = new Map(initialCounts);
  const shares = request.leaders.map((l) => ({ id: l.id, share: totalWeight ? freeSlots * l.targetWeight / totalWeight : 0 }));
  shares.forEach((s) => quotas.set(s.id, quotas.get(s.id)! + Math.floor(s.share)));
  let rounding = totalWeight ? freeSlots - shares.reduce((s, p) => s + Math.floor(p.share), 0) : 0;
  for (const s of [...shares].sort((a, b) => (b.share % 1) - (a.share % 1) || stableCompare(a.id, b.id))) if (rounding-- > 0) quotas.set(s.id, quotas.get(s.id)! + 1);
  const residuals = new Map<string, number>();
  const directPlacementTurns = new Map<string, number>();
  const quota = (key: string, amount: number) => { const x = (residuals.get(key) ?? 0) + amount; const n = Math.floor(x + 1e-9); residuals.set(key, x - n); return n; };
  const months: StrategyMonth[] = []; const warnings = new Set<string>();
  const checkpoints: StrategyVariantResult["checkpoints"] = CHECKPOINTS.map((count) => ({ memberCount: count, reached: false, reachedMonth: null, actualCount: 0, remaining: count, snapshot: null, organization: [] }));
  const done = new Set<string>(); const keyIds = new Set([...baselineOwned, ...request.leaders.map(profileMemberId)]);
  const orderedProfiles: LeaderGrowthProfile[] = [];
  const visitedProfiles = new Set<string>();
  const orderProfile = (profile: LeaderGrowthProfile) => {
    if (visitedProfiles.has(profile.id)) return;
    visitedProfiles.add(profile.id);
    const parent = request.leaders.find(l => profileMemberId(l) === (candidate.placements[profile.id] ?? profile.placementId));
    if (parent && parent.id !== profile.id) orderProfile(parent);
    orderedProfiles.push(profile);
  };
  request.leaders.forEach(orderProfile);
  const reservedSlots = (except?: string) => {
    const reserved = new Map<string, number>();
    if (request.placementMode !== "manual") return reserved;
    for (const l of request.leaders) if (!l.existingMemberId && l.id !== except && !people.some(p => p.member.id === profileMemberId(l))) {
      const parent = candidate.placements[l.id] ?? l.placementId;
      reserved.set(parent, (reserved.get(parent) ?? 0) + 1);
    }
    return reserved;
  };
  let titleMonth: number | null = null, completionMonth: number | null = null;
  let completion: StrategyMonth | null = null, steady: StrategyMonth | null = null;
  let finalOrganization: StrategyNode[] = [], serial = 0, cumulative = 0, missingAssumptions = false;
  let lastBirths = 0, maintenanceFailures = 0;
  let priorDirectorPv: Map<string, number> | undefined;
  const add = (m: Member, profileId: string | null, month: number) => { people.push({ member: m, profileId, joinedMonth: month, active: true, exited: false, introductions: 0, credit: 0 }); };
  for (let month = 0; month <= Math.max(request.horizonMonths, completionMonth === null ? 0 : completionMonth + 12); month++) {
    const period = nextPeriod(base.period, month); const changes: string[] = []; let births = 0;
    if (month > 0) {
      // Membership changes use qualification conditions from the previous closed month.
      const applyActions = () => {
      for (const action of candidate.actions) {
        if (done.has(action.id) || action.month > month) continue;
        if (action.requiredMemberId && rank(snapshot.members.find((m) => m.id === action.requiredMemberId)?.title ?? "NONE") < rank(action.requiredTitle)) continue;
        const person = people.find((p) => p.member.id === action.memberId);
        const members = people.map((p) => p.member);
        if (action.kind === "create-sub") {
          if (!request.allowSubCreation || !action.ownerId || !owners.includes(action.ownerId) || person) continue;
          if (members.filter((m) => m.masterMemberId === action.ownerId && alive(m, period)).length >= planConfig.maxSubIdsPerMaster) continue;
          const parent = placementSlot(members, action.parentId ?? action.ownerId, period);
          if (!parent || parent !== (action.parentId ?? action.ownerId)) continue;
          const m = blankMember(action.memberId, parent, base.workspaceId, period);
          Object.assign(m, { displayName: "試算サブ", idKind: "sub", masterMemberId: action.ownerId, introducerMemberId: action.ownerId, course: action.course });
          add(m, null, month); keyIds.add(m.id);
        } else if (action.kind === "delete-sub") {
          if (!request.allowSubDeletion || !request.provisionalCompression || !person || person.exited || person.member.idKind !== "sub" || !owners.includes(person.member.masterMemberId ?? "") || person.member.id === request.targetId) continue;
          for (const p of people) if (p.member.parentMemberId === person.member.id) p.member.parentMemberId = person.member.parentMemberId;
          person.member.endedPeriod = period; person.exited = true; person.active = false;
          changes.push("暫定ルール：サブ削除で配下を1段繰上げ");
        } else if (action.kind === "move") {
          if (!request.allowMove || !person || person.exited || baselineOwned.has(person.member.id) || !action.parentId) continue;
          const temp = { ...snapshot, members }; const descendantsIds = new Set(descendants(temp, person.member.id).map((d) => d.member.id));
          if (person.member.id === action.parentId || descendantsIds.has(action.parentId) || placementSlot(members, action.parentId, period) !== action.parentId) continue;
          person.member.parentMemberId = action.parentId;
        } else if (action.kind === "change-course") {
          if (!person || person.exited) continue;
          person.member.course = action.course;
        } else if (action.kind === "qualification") {
          if (!person) continue;
          person.member.sponsorLicense ||= action.sponsorLicense;
          person.member.openStudioAttendances = Math.max(person.member.openStudioAttendances, action.studioAttendances);
          if (action.trainerCredential === "PT") { person.member.preTrainerCourseCompleted ||= action.courseCompleted; person.member.preTrainerKitPurchased ||= action.kitPurchased; }
          if (action.trainerCredential === "ST") { person.member.startTrainerCourseCompleted ||= action.courseCompleted; person.member.startTrainerKitPurchased ||= action.kitPurchased; }
        }
        done.add(action.id); changes.push(`${({ "create-sub": "サブ作成", "delete-sub": "サブ削除", move: "配置親の変更", qualification: "資格取得予定を反映", "change-course": "コース変更" })[action.kind]}：${person?.member.displayName ?? "試算サブ"}`);
      }
      };
      applyActions();
      for (const profile of orderedProfiles) {
        const stress = request.stress;
        const delayed = stress.kind === "leader-delay" && (!stress.leaderId || stress.leaderId === profile.id) ? stress.duration : 0;
        const start = Math.max(1, profile.startMonth) + delayed;
        const localMonth = month - delayed;
        const phase = phaseAt(profile, localMonth);
        if (!phase) { if (month >= start) missingAssumptions = true; continue; }
        if (month < start) continue;
        const stressed = month >= stress.fromMonth && month < stress.fromMonth + stress.duration && (!stress.leaderId || stress.leaderId === profile.id);
        const rates = { ...phase.rates[band] };
        if (stressed && stress.kind === "retention-drop") rates.retention = Math.max(0, rates.retention - stress.retentionDrop);
        const stopped = stressed && stress.kind === "recruitment-stop";
        let leader = people.find((p) => p.member.id === profileMemberId(profile));
        const profileActiveCount = () => people.filter((p) => p.profileId === profile.id && p.active && !p.exited && p.member.id !== request.rootId).length;
        if (!leader && !profile.existingMemberId) {
          if (profileActiveCount() >= quotas.get(profile.id)!) continue;
          if (people.filter((p) => p.active && !p.exited && p.member.id !== request.rootId).length >= request.targetIds) continue;
          const wantedParent = candidate.placements[profile.id] ?? profile.placementId;
          const parent = placementIndex(people.map((p) => p.member), period, reservedSlots(profile.id)).slot(wantedParent);
          if (!parent) { warnings.add(`${profile.name}の配置先がまだ存在しません`); continue; }
          if (request.placementMode === "manual" && parent !== wantedParent) { warnings.add(`${profile.name}は指定した配置先に空きがなく加入を保留しています`); continue; }
          const member = blankMember(profileMemberId(profile), parent, base.workspaceId, period);
          Object.assign(member, { displayName: profile.name, course: profile.leaderCourse, introducerMemberId: candidate.introducers[profile.id] ?? profile.introducerId });
          add(member, profile.id, month); leader = people.at(-1)!; births++;
        }
        if (!leader || leader.exited) continue;
        const team = people.filter((p) => p.profileId === profile.id && !p.exited && !baselineOwned.has(p.member.id) && p.joinedMonth < month);
        const active = team.filter((p) => p.active), inactive = team.filter((p) => !p.active);
        // Fractional counts accumulate separately for each profile/event, avoiding
        // monthly rounding that would silently eliminate small attrition rates.
        const inactiveCount = quota(`${profile.id}/inactive`, active.length * (1 - rates.retention));
        if (inactiveCount > 0) for (const p of active.slice(-inactiveCount)) p.active = false;
        // Stable identity selection, independent of placement and objective.
        const exitCount = quota(`${profile.id}/exit`, team.length * rates.exitRate);
        for (const p of team.slice(0, exitCount)) { p.exited = true; p.active = false; p.member.endedPeriod = period; }
        const restart = quota(`${profile.id}/restart`, inactive.length * rates.reactivation);
        for (const p of inactive.filter((p) => !p.exited).slice(0, restart)) p.active = true;
        if (profile.licenseAfterMonths !== null) for (const p of people.filter((p) => p.profileId === profile.id && month - p.joinedMonth >= profile.licenseAfterMonths!)) p.member.sponsorLicense = true;
        const teamStart = done.has(`team/${profile.id}`) ? 0 : profile.initialTeam;
        if (!stopped) done.add(`team/${profile.id}`);
        let direct = stopped ? 0 : quota(`${profile.id}/direct`, rates.introductions) + teamStart;
        const recruiters = [...people.filter((p) => p.profileId === profile.id && p.member.idKind === "master" && p.active && !p.exited && month - p.joinedMonth >= phase.recruitmentDelay && p.member.id !== leader!.member.id)];
        const planned: Person[] = [];
        while (direct-- > 0) planned.push(leader);
        if (!stopped) for (const recruiter of recruiters) {
          recruiter.credit += rates.activity * rates.perRecruiter;
          const n = Math.min(Math.floor(recruiter.credit + 1e-9), Math.max(0, phase.maxPerMember - recruiter.introductions));
          recruiter.credit -= n;
          for (let i = 0; i < n; i++) planned.push(recruiter);
        }
        let activeCount = people.filter((p) => p.active && !p.exited && p.member.id !== request.rootId).length;
        let profileCount = profileActiveCount();
        const slots = placementIndex(people.map((p) => p.member), period, reservedSlots());
        for (const recruiter of planned) {
          if (activeCount >= request.targetIds || profileCount >= quotas.get(profile.id)! || people.length >= 5000) break;
          const targets = recruiter === leader && profile.existingMemberId ? candidate.directPlacements[profile.id] ?? [profile.placementId] : [recruiter.member.id];
          const turn = directPlacementTurns.get(profile.id) ?? 0;
          const wanted = targets[turn % targets.length]!;
          const parent = slots.slot(wanted);
          if (!parent) continue;
          const m = blankMember(`strategy-${profile.id}-${++serial}`, parent, base.workspaceId, period);
          const target = people.find((p) => p.member.id === wanted)?.member;
          const sameOwner = target && (target.masterMemberId ?? target.id) === (recruiter.member.masterMemberId ?? recruiter.member.id);
          const introducerId = request.allowIntroducerIdChoice && sameOwner ? wanted : recruiter.member.id;
          Object.assign(m, { displayName: `試算 ${serial}`, course: phase.course, introducerMemberId: introducerId, trainerMemberId: request.trainerId, trainerBonusRole: request.trainerRole, sponsorLicense: profile.licenseAfterMonths === 0 });
          add(m, profile.id, month); slots.add(m); recruiter.introductions++; births++; activeCount++; profileCount++;
          if (recruiter === leader) directPlacementTurns.set(profile.id, turn + 1);
        }
      }
      // A qualification scheduled for a newly joined leader can apply in the
      // joining month, before that month's titles and payouts are evaluated.
      applyActions();
      const currentPurchases: PurchaseEvent[] = [];
      for (const p of people) {
        if (p.exited || !p.active || p.member.joinedPeriod > period) continue;
        const profile = p.profileId ? profiles.get(p.profileId) : undefined;
        const phase = profile ? phaseAt(profile, month) : undefined;
        const initial = p.joinedMonth === month;
        const purchase: PurchaseEvent = { id: `strategy-p-${month}-${p.member.id}`, memberId: p.member.id, workspaceId: base.workspaceId, period, productCode: null, kind: "repeat", status: "confirmed", quantity: 1,
          price: request.courseMonthlyCosts[p.member.course], pv: planConfig.courses[p.member.course].recurringPv };
        currentPurchases.push(purchase);
        if (initial) currentPurchases.push({ ...purchase, id: `${purchase.id}-initial`, kind: "initial" });
        if (phase?.additionalPv) currentPurchases.push({ ...purchase, id: `${purchase.id}-additional`, kind: "additional", pv: phase.additionalPv });
      }
      snapshot = { workspaceId: base.workspaceId, period, members: people.map((p) => ({ ...p.member })), purchases: [...snapshot.purchases.filter((p) => p.period === previousPeriod(period)), ...currentPurchases] };
    }
    const evaluated = evaluateStrategyMonth(snapshot, request, month, acquired, carries, priorDirectorPv);
    snapshot = evaluated.snapshot; const row = evaluated.row;
    priorDirectorPv = new Map(snapshot.members.map((m) => [m.id, groupPvThroughDepth(snapshot, m.id, 3)]));
    const peopleById = new Map(people.map((p) => [p.member.id, p]));
    for (const m of snapshot.members) {
      const person = peopleById.get(m.id);
      if (person) { person.member.directorPromotedPeriod = m.directorPromotedPeriod; person.member.trainerCredential = m.trainerCredential; }
    }
    if (month > 0) cumulative += row.cashflow;
    row.cumulative = cumulative; row.changes = changes; months.push(row);
    if (rank(row.targetTitle) >= rank(request.targetTitle) && titleMonth === null) titleMonth = month;
    if (titleMonth !== null && rank(row.targetTitle) < rank(request.targetTitle)) maintenanceFailures++;
    for (const checkpoint of checkpoints) if (!checkpoint.reached && row.count >= checkpoint.memberCount) {
      Object.assign(checkpoint, { reached: true, reachedMonth: month, actualCount: row.count, remaining: 0, snapshot: row, organization: summarizeOrganization(snapshot, request.rootId, keyIds) });
    }
    if ((request.goalBasis === "title" ? rank(row.targetTitle) >= rank(request.targetTitle) : row.count >= request.targetIds) && completionMonth === null) {
      completionMonth = month; completion = row;
      // Keep the title actually awarded this month. Re-evaluating it would
      // incorrectly switch an acquisition month to maintenance conditions.
      steady = { ...structuredClone(row), gross: row.recurring, net: row.recurringNet, cashflow: row.recurringCashflow,
        ids: row.ids.map((id) => ({ ...id, start: 0, trainerBonus: 0, gross: id.recurring })),
        payees: owners.map((owner) => {
          const own = row.ids.filter((id) => id.ownerId === owner);
          const line = own.reduce((s, id) => s + id.line, 0), director = own.reduce((s, id) => s + id.director, 0), title = own.reduce((s, id) => s + id.titleBonus, 0);
          return { id: owner, bonus: settleBonus({ start: 0, trainer: 0, line, director, title, gross: line + director + title }, period, { ...(request.taxes[owner] ?? zeroTax), priorCarryover: 0 }) };
        }) };
      finalOrganization = summarizeOrganization(snapshot, request.rootId, keyIds);
    }
    lastBirths = births;
    yield month;
  }
  const last = months.at(-1)!;
  if (!finalOrganization.length) finalOrganization = summarizeOrganization(snapshot, request.rootId, keyIds);
  checkpoints.filter((c) => !c.reached).forEach((c) => { c.remaining = Math.max(0, c.memberCount - last.count); c.actualCount = last.count; });
  const noFutureGrowth = request.leaders.every((l) => l.phases.every((p) => p.rates[band].introductions === 0 && (p.rates[band].activity === 0 || p.rates[band].perRecruiter === 0)) && l.startMonth <= request.horizonMonths);
  const canReactivate = people.some((p) => !p.exited && !p.active && p.profileId && profiles.get(p.profileId)?.phases.some((phase) => phase.rates[band].reactivation > 0));
  if (people.length >= 5000) warnings.add("在籍・終了を含む5,000 IDの計算上限に達しました。期間・退会前提を見直してください");
  if (request.provisionalCompression) warnings.add("サブ削除時の繰上げは暫定・出典未確認のルールを使用しています");
  if (months.some((m) => m.exited > 0)) warnings.add("通常IDの退会後は、配下の在籍と元の段数を維持する仮定です。通常退会の公式圧縮条件は未確認です");
  if (!request.taxes[request.partnerId ?? request.rootId]) warnings.add("未入力の支払先は控除なしで試算しています");
  warnings.add("初月は初回購入と当月リピートの両方を計上する前提です");
  const post = completionMonth === null ? [] : months.filter((m) => m.month > completionMonth! && m.month <= completionMonth! + 12);
  const recentStart = months[Math.max(0, months.length - 13)]!;
  const recentMonthlyGrowth = last.month > recentStart.month ? (last.count - recentStart.count) / (last.month - recentStart.month) : 0;
  return { candidate, band, months, checkpoints, titleMonth, completionMonth, completion, steady, finalOrganization,
    recentMonthlyGrowth, referenceArrivalMonth: completionMonth ?? (request.goalBasis !== "title" && recentMonthlyGrowth > 0 && !missingAssumptions ? last.month + Math.ceil((request.targetIds - last.count) / recentMonthlyGrowth) : null),
    status: completionMonth !== null ? "reached" : missingAssumptions ? "missing-assumptions" : noFutureGrowth && !canReactivate && lastBirths === 0 ? "stalled" : "horizon",
    postCompletionAverage: post.length === 12 ? post.reduce((s, m) => s + m.recurringCashflow, 0) / 12 : null,
    maintenanceFailures, warnings: [...warnings], pendingActions: candidate.actions.filter((a) => !done.has(a.id)).map((a) => a.id),
    finalDesign: { target: request.targetIds, allocated: fixedMembers + [...quotas.values()].reduce((a, b) => a + b, 0), remaining: totalWeight ? 0 : freeSlots, fixedMembers,
      lines: request.leaders.map((l) => ({ leaderId: profileMemberId(l), parentId: l.existingMemberId ? base.members.find((m) => m.id === l.existingMemberId)?.parentMemberId ?? request.rootId : candidate.placements[l.id] ?? l.placementId, quota: quotas.get(l.id)! })) } };
}

export interface StrategyProgress { completed: number; total: number; candidate: string; band: Band; month: number }
export async function runStrategy(base: OrganizationSnapshot, request: StrategySimulationRequest, progress?: (value: StrategyProgress) => void, cancelled?: () => boolean): Promise<StrategySimulationResult> {
  const originalBase = base;
  validateStrategyBase(base, request);
  base = applyPlacementOverrides(base, request);
  const candidates = candidateStrategies(base, request);
  const standard: StrategyVariantResult[] = [];
  let completed = 0; const total = candidates.length + 9;
  const cache = new Map<string, StrategyVariantResult>();
  const baselineRequest = { ...request, stress: { ...request.stress, kind: "none" as const } };
  const evaluate = async (candidate: StrategyCandidate, band: Band, stressed = false) => {
    const ratesKey = JSON.stringify(request.leaders.map((l) => l.phases.map((p) => p.rates[band])));
    const cacheKey = `${candidate.id}/${ratesKey}/${stressed && request.stress.kind !== "none"}`;
    const cached = cache.get(cacheKey); if (cached) return { ...cached, band };
    const iterator = simulateStrategy(base, stressed ? request : baselineRequest, candidate, band, originalBase);
    for (;;) {
      if (cancelled?.()) throw new Error("計算をキャンセルしました");
      const step = iterator.next(); if (step.done) { completed++; cache.set(cacheKey, step.value); return step.value; }
      if (step.value % 6 === 0) { progress?.({ completed, total, candidate: candidate.label, band, month: step.value }); await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
    }
  };
  for (const candidate of candidates) standard.push(await evaluate(candidate, "standard"));
  const time = (r: StrategyVariantResult) => r.titleMonth ?? Infinity;
  const endCash = (r: StrategyVariantResult) => r.steady?.recurringCashflow ?? -Infinity;
  const tie = (a: StrategyVariantResult, b: StrategyVariantResult) => stableCompare(a.candidate.id, b.candidate.id);
  const commonMonth = Math.min(...standard.map((r) => r.months.at(-1)!.month));
  const fastest = [...standard].sort((a, b) => time(a) - time(b) || a.months[commonMonth]!.missing.length - b.months[commonMonth]!.missing.length || b.months[commonMonth]!.cumulative - a.months[commonMonth]!.cumulative || tie(a, b))[0]!;
  const income = [...standard].sort((a, b) => (b.postCompletionAverage ?? endCash(b)) - (a.postCompletionAverage ?? endCash(a)) || b.months[commonMonth]!.recurringCashflow - a.months[commonMonth]!.recurringCashflow || tie(a, b))[0]!;
  const within = standard.filter((r) => time(r) <= Math.ceil(time(fastest) * (1 + request.delayTolerance)));
  const balanced = [...(within.length ? within : standard)].sort((a, b) =>
    b.months[commonMonth]!.cumulative - a.months[commonMonth]!.cumulative || a.maintenanceFailures - b.maintenanceFailures || tie(a, b))[0]!;
  const variants: StrategySimulationResult["variants"] = [];
  const stressImpact: StrategySimulationResult["stressImpact"] = [];
  for (const [objective, selected] of [["fastest", fastest], ["income", income], ["balanced", balanced]] as const) {
    const conservative = await evaluate(selected.candidate, "conservative", true);
    const challenge = await evaluate(selected.candidate, "challenge", true);
    const standardResult = await evaluate(selected.candidate, "standard", true);
    if (request.stress.kind !== "none") for (const stressed of [conservative, standardResult, challenge]) {
      const baseline = await evaluate(selected.candidate, stressed.band);
      const month = Math.min(baseline.months.at(-1)!.month, stressed.months.at(-1)!.month);
      const before = baseline.months[month]!, after = stressed.months[month]!;
      stressImpact.push({ objective, band: stressed.band, month, countDelta: after.count - before.count, recurringDelta: after.recurring - before.recurring, cumulativeDelta: after.cumulative - before.cumulative });
    }
    variants.push({ objective, candidateId: selected.candidate.id, bands: { conservative, standard: standardResult, challenge } });
  }
  const crossovers: StrategySimulationResult["crossovers"] = [];
  for (let i = 0; i < variants.length; i++) for (let j = i + 1; j < variants.length; j++) {
    const a = variants[i]!, b = variants[j]!; let month: number | null = null; let behind = false;
    const length = Math.min(a.bands.standard.months.length, b.bands.standard.months.length);
    for (let k = 1; k < length; k++) {
      const delta = b.bands.standard.months[k]!.cumulative - a.bands.standard.months[k]!.cumulative;
      if (delta < 0) behind = true;
      if (behind && delta >= 0) { month = k; break; }
    }
    crossovers.push({ left: a.objective as Objective, right: b.objective as Objective, month });
  }
  return { engineVersion: STRATEGY_VERSION, planVersion: planConfig.version, fingerprint: inputFingerprint(originalBase, request), explored: candidates.length, comparisonMonth: commonMonth, stressImpact, variants, crossovers };
}
