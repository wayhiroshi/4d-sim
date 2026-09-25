import { z } from "zod";
import { COURSES, TITLE_ORDER, type BonusBreakdown, type Member, type OrganizationSnapshot, type PlanConfig, type SavedForecast, type TaxProfile, type TitleCode } from "./types";

export const STRATEGY_VERSION = "2.1.0";
export const CHECKPOINTS = [100, 300, 500, 1000, 1500, 2000] as const;
export const BANDS = ["conservative", "standard", "challenge"] as const;
export type Band = typeof BANDS[number];
export type Objective = "fastest" | "income" | "balanced";
const id = z.string().min(1).max(120);
const month = z.number().int().min(0).max(12000);
export const taxSchema = z.object({ invoiceRegistered: z.boolean(), withholdingRate: z.number().min(0).max(1), transferFee: z.number().int().nonnegative(), offsets: z.number().int().nonnegative(), priorCarryover: z.number().int().nonnegative() });
const rates = z.object({
  introductions: z.number().min(0).max(100),
  activity: z.number().min(0).max(1),
  perRecruiter: z.number().min(0).max(10),
  retention: z.number().min(0).max(1),
  exitRate: z.number().min(0).max(1),
  reactivation: z.number().min(0).max(1)
});
export const phaseSchema = z.object({
  fromMonth: month, toMonth: month.nullable(),
  rates: z.object({ conservative: rates, standard: rates, challenge: rates }),
  course: z.enum(COURSES), additionalPv: z.number().int().min(0).max(1000000),
  recruitmentDelay: z.number().int().min(1).max(120), maxPerMember: z.number().int().min(0).max(100)
});
export const leaderSchema = z.object({
  id, name: z.string().trim().min(1).max(80), existingMemberId: id.nullable(),
  introducerId: id, placementId: id, startMonth: month,
  initialTeam: z.number().int().min(0).max(2000),
  leaderCourse: z.enum(COURSES).default("G"),
  targetWeight: z.number().min(0).max(100).default(1),
  licenseAfterMonths: month.nullable(), phases: z.array(phaseSchema).min(1).max(30)
});
export const actionSchema = z.object({
  id, kind: z.enum(["create-sub", "delete-sub", "move", "qualification", "change-course"]),
  month, memberId: id, parentId: id.nullable(), ownerId: id.nullable(),
  course: z.enum(COURSES).default("G"),
  requiredMemberId: id.nullable(), requiredTitle: z.enum(TITLE_ORDER).default("NONE"),
  sponsorLicense: z.boolean().default(false),
  trainerCredential: z.enum(["NONE", "PT", "ST"]).default("NONE"),
  studioAttendances: z.number().int().min(0).max(100).default(0),
  courseCompleted: z.boolean().default(false), kitPurchased: z.boolean().default(false)
});
export const strategyRequestSchema = z.object({
  placementMode: z.enum(["search", "manual"]).default("search"),
  placementOverrides: z.record(id, id).default({}),
  goalBasis: z.enum(["members", "title"]).default("members"),
  name: z.string().trim().max(120).default("試算"), rootId: id, partnerId: id.nullable(),
  targetId: id, targetTitle: z.enum(TITLE_ORDER).default("TRD"), targetIds: z.number().int().min(100).max(5000).default(2000),
  horizonMonths: z.number().int().min(12).max(12000).default(120),
  delayTolerance: z.number().min(0).max(2).default(0.2),
  includeTrial: z.boolean().default(true), allowSubCreation: z.boolean().default(false),
  allowIntroducerIdChoice: z.boolean().default(false),
  allowSubDeletion: z.boolean().default(false), allowMove: z.boolean().default(false),
  provisionalCompression: z.boolean().default(false),
  leaders: z.array(leaderSchema).min(1).max(12), actions: z.array(actionSchema).max(100).default([]),
  ownedMonthlyCosts: z.record(z.string(), z.number().int().min(0).max(1000000)),
  courseMonthlyCosts: z.object({ A: z.number().nonnegative(), B: z.number().nonnegative(), F: z.number().nonnegative(), G: z.number().nonnegative(), I: z.number().nonnegative() }),
  taxes: z.record(z.string(), taxSchema),
  trainerId: id.nullable().default(null), trainerRole: z.enum(["PT", "ST_SOLO", "ST_WITH_PT"]).nullable().default(null),
  stress: z.object({ kind: z.enum(["none", "leader-delay", "retention-drop", "recruitment-stop"]), leaderId: id.nullable(), fromMonth: month, duration: z.number().int().min(1).max(120), retentionDrop: z.number().min(0).max(1) }).default({ kind: "none", leaderId: null, fromMonth: 1, duration: 6, retentionDrop: 0.1 })
}).superRefine((value, context) => {
  if (value.rootId === value.partnerId) context.addIssue({ code: "custom", message: "自分とパートナーは別IDにしてください" });
  const seen = new Set<string>();
  const existing = new Set<string>();
  for (const [i, leader] of value.leaders.entries()) {
    if (seen.has(leader.id)) context.addIssue({ code: "custom", path: ["leaders", i], message: "リーダーIDが重複しています" });
    seen.add(leader.id);
    if (leader.existingMemberId) {
      if (existing.has(leader.existingMemberId)) context.addIssue({ code: "custom", path: ["leaders", i], message: "同じ既存リーダーを重複して設定できません" });
      existing.add(leader.existingMemberId);
    }
    for (const [j, phase] of leader.phases.entries()) {
      const prior = leader.phases[j - 1];
      if ((phase.toMonth !== null && phase.toMonth < phase.fromMonth) ||
        (prior && (prior.toMonth === null || phase.fromMonth <= prior.toMonth)))
        context.addIssue({ code: "custom", path: ["leaders", i, "phases", j], message: "成長期間が重複・逆転しています" });
    }
  }
});
export type StrategySimulationRequest = z.infer<typeof strategyRequestSchema>;
export type LeaderGrowthProfile = z.infer<typeof leaderSchema>;
export type StrategyAction = z.infer<typeof actionSchema>;
export type GrowthPhase = z.infer<typeof phaseSchema>;
export interface StrategyCandidate { id: string; label: string; placements: Record<string, string>; introducers: Record<string, string>; directPlacements: Record<string, string[]>; actions: StrategyAction[] }
export interface IdIncome { id: string; name: string; ownerId: string; title: TitleCode; acquiredTitle: TitleCode; trainer: string; start: number; trainerBonus: number; line: number; director: number; titleBonus: number; gross: number; recurring: number; cost: number }
export interface StrategyMonth {
  month: number; period: string; count: number; enrolled: number; inactive: number; exited: number; ownedSubs: number; pv: number;
  targetTitle: TitleCode; missing: string[]; gross: number; recurring: number; recurringNet: number; recurringCashflow: number; line: number; net: number; costs: number; cashflow: number; cumulative: number;
  ids: IdIncome[]; payees: Array<{ id: string; bonus: BonusBreakdown }>; changes: string[];
}
export interface StrategyCheckpointResult { memberCount: number; reached: boolean; reachedMonth: number | null; actualCount: number; remaining: number; snapshot: StrategyMonth | null; organization: StrategyNode[] }
export interface StrategyNode { id: string; name: string; parentId: string | null; introducerId: string | null; ownerId: string | null; course: string; title: TitleCode; count: number; active: number; depth: number }
export interface StrategyVariantResult {
  candidate: StrategyCandidate; band: Band; months: StrategyMonth[]; checkpoints: StrategyCheckpointResult[];
  status: "reached" | "horizon" | "stalled" | "missing-assumptions"; titleMonth: number | null; completionMonth: number | null;
  finalOrganization: StrategyNode[]; completion: StrategyMonth | null; steady: StrategyMonth | null;
  referenceArrivalMonth: number | null; recentMonthlyGrowth: number;
  postCompletionAverage: number | null; maintenanceFailures: number; warnings: string[]; pendingActions: string[];
  finalDesign: { target: number; allocated: number; remaining: number; fixedMembers: number; lines: Array<{ leaderId: string; parentId: string; quota: number }> };
}
export interface StrategySimulationResult {
  engineVersion: string; planVersion: string; fingerprint: string; explored: number; comparisonMonth: number;
  stressImpact: Array<{ objective: Objective; band: Band; month: number; countDelta: number; recurringDelta: number; cumulativeDelta: number }>;
  variants: Array<{ objective: Objective; candidateId: string; bands: Record<Band, StrategyVariantResult> }>;
  crossovers: Array<{ left: Objective; right: Objective; month: number | null }>;
}
export interface StrategyContext { snapshot: OrganizationSnapshot; trialIds: string[]; tax: TaxProfile; planVersion: string; legacy: SavedForecast[] }
export interface StrategyRevision {
  id: string; planId: string; name: string; createdAt: string; request: StrategySimulationRequest;
  base: OrganizationSnapshot; result: StrategySimulationResult;
  ruleSnapshot: PlanConfig;
}
export interface StrategyPlanSummary { id: string; name: string; updatedAt: string; revisionId: string; archived: boolean }
export const blankMember = (id: string, parentId: string | null, workspaceId: string, period: string): Member => ({
  id, displayName: id, parentMemberId: parentId, introducerMemberId: parentId, workspaceId,
  masterMemberId: null, trainerMemberId: null, trainerBonusRole: null, idKind: "master", course: "A", title: "NONE", trainerCredential: "NONE", sponsorLicense: false,
  openStudioAttendances: 0, preTrainerCourseCompleted: false, preTrainerKitPurchased: false, startTrainerCourseCompleted: false, startTrainerKitPurchased: false,
  directorPromotedPeriod: null, joinedPeriod: period, endedPeriod: null
});
export function defaultPhase(): GrowthPhase {
  return { fromMonth: 1, toMonth: null, course: "A", additionalPv: 0, recruitmentDelay: 3, maxPerMember: 3,
    rates: { conservative: { introductions: 0.25, activity: 0.05, perRecruiter: 0.25, retention: 0.98, exitRate: 0, reactivation: 0.1 },
      standard: { introductions: 0.5, activity: 0.1, perRecruiter: 0.5, retention: 0.99, exitRate: 0, reactivation: 0.2 },
      challenge: { introductions: 1, activity: 0.2, perRecruiter: 0.5, retention: 0.995, exitRate: 0, reactivation: 0.3 } } };
}
