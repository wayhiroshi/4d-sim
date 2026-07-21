export const COURSES = ["A", "B", "F", "G", "I"] as const;
export type CourseCode = (typeof COURSES)[number];

export const TITLE_ORDER = ["NONE", "LD", "LL", "DR", "SD", "TD", "TRD"] as const;
export type TitleCode = (typeof TITLE_ORDER)[number];
export type TrainerCredential = "NONE" | "PT" | "ST";
export type TrainerBonusRole = "PT" | "ST_SOLO" | "ST_WITH_PT";
export type IdKind = "master" | "sub";
export type PurchaseKind = "initial" | "repeat" | "additional";
export type RecordStatus = "planned" | "confirmed";

export interface CourseRule {
  code: CourseCode;
  recurringPv: number;
  startBonus: number;
  maxBaseDepth: number;
  baseLineRates: number[];
}

export interface ProductRule {
  code: string;
  name: string;
  price: number;
  pv: number;
  conversion: number;
  category: "drink" | "supplement" | "cosmetic" | "other";
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface TitleRule {
  code: Exclude<TitleCode, "NONE">;
  label: string;
  rank: number;
  titleBonusRate: number;
  sameRankRates: number[];
  directIntroductions: number;
  groupMembers: number | null;
  groupPv: number | null;
  requiredDirectTitle: TitleCode | null;
  requiredDirectTitleCount: number;
}

export interface PlanConfig {
  planId: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  businessMonthStartDay: number;
  firstLineLimit: number;
  compression: { enabled: boolean; promoteEndedMembers: boolean; firstLineMayExceedLimit: boolean };
  courses: Record<CourseCode, CourseRule>;
  trainerBonuses: Record<CourseCode, Record<TrainerBonusRole, number>>;
  products: ProductRule[];
  titles: TitleRule[];
  ld: {
    firstLineActive: number;
    secondLineActive: number;
    directActive: number;
  };
  director: {
    directActive: number;
    pattern1: { first: number; second: number; third: number; rollingTwoMonthPv: number };
    pattern2: { firstTwoLineTotal: number; currentPv: number; rollingTwoMonthPv: number };
    maintenancePv: number;
    promotionFollowingMonthMaintenanceException: boolean;
    pattern2ExcludesSevenOrMoreIds: boolean;
  };
  lineRatesByTitle: Partial<Record<TitleCode, Partial<Record<CourseCode, number[]>>>>;
  tax: {
    paymentCarryoverThreshold: number;
    invoiceTransitions: Array<{ from: string; to: string; disallowedInputTaxRate: number }>;
  };
  sources: Array<{ name: string; revision: string; pages: string }>;
}

export interface Member {
  id: string;
  workspaceId: string;
  displayName: string;
  parentMemberId: string | null;
  introducerMemberId: string | null;
  masterMemberId: string | null;
  trainerMemberId: string | null;
  trainerBonusRole?: TrainerBonusRole | null;
  idKind: IdKind;
  course: CourseCode;
  title: TitleCode;
  trainerCredential: TrainerCredential;
  sponsorLicense: boolean;
  directorPromotedPeriod: string | null;
  joinedPeriod: string;
  endedPeriod: string | null;
}

export interface PurchaseEvent {
  id: string;
  workspaceId: string;
  memberId: string;
  period: string;
  productCode: string | null;
  kind: PurchaseKind;
  status: RecordStatus;
  quantity: number;
  price: number;
  pv: number;
}

export interface Goal {
  workspaceId: string;
  targetTitle: TitleCode;
  targetPeriod: string;
}

export interface TaxProfile {
  invoiceRegistered: boolean;
  withholdingRate: number;
  transferFee: number;
  offsets: number;
  priorCarryover: number;
}

export interface OrganizationSnapshot {
  workspaceId: string;
  period: string;
  members: Member[];
  purchases: PurchaseEvent[];
}

export interface SimulationMember {
  id: string;
  workspaceId: string;
  displayName: string;
  parentMemberId: string;
  introducerMemberId: string;
  trainerMemberId: string | null;
  trainerBonusRole: TrainerBonusRole | null;
  course: CourseCode;
  period: string;
  createdAt: string;
}

export interface SimulationOrganization {
  snapshot: OrganizationSnapshot;
  simulationMembers: SimulationMember[];
}

export interface ConditionResult {
  key: string;
  label: string;
  current: number | boolean | string;
  required: number | boolean | string;
  met: boolean;
}

export interface TitleEvaluation {
  achievedTitle: TitleCode;
  nextTitle: TitleCode | null;
  progress: number;
  conditions: ConditionResult[];
}

export interface TitleChecklistItem {
  code: Exclude<TitleCode, "NONE">;
  label: string;
  rank: number;
  status: "achieved" | "next" | "future";
  progress: number;
  conditions: ConditionResult[];
  alternatives?: Array<{
    label: string;
    met: boolean;
    conditions: ConditionResult[];
  }>;
}

export interface TitleChecklistData {
  period: string;
  achievedTitle: TitleCode;
  planVersion: string;
  titles: TitleChecklistItem[];
  sources: PlanConfig["sources"];
}

export interface BonusBreakdown {
  start: number;
  trainer: number;
  line: number;
  director: number;
  title: number;
  gross: number;
  estimatedNet: number;
  deductions: {
    invoiceTransition: number;
    withholding: number;
    transferFee: number;
    offsets: number;
  };
  carryover: number;
}

export interface Mission {
  id: string;
  priority: number;
  category: "title" | "data";
  title: string;
  reason: string;
  dueDate: string | null;
}

export interface SimulationRequest {
  candidateName: string;
  course: CourseCode;
  period: string;
  targetTitle: TitleCode;
  placementCandidateIds?: string[];
  trainerBonusRole?: TrainerBonusRole | null;
  taxProfile: TaxProfile;
}

export interface PlacementBonusDelta {
  start: number;
  trainer: number;
  line: number;
  director: number;
  title: number;
  oneTime: number;
  recurring: number;
  gross: number;
  estimatedNet: number;
}

export interface PlacementResult {
  placementMemberId: string;
  placementMemberName: string;
  eligible: boolean;
  rank: number | null;
  grossDelta: number;
  estimatedNetDelta: number;
  bonusDelta: PlacementBonusDelta;
  titleBefore: TitleCode;
  titleAfter: TitleCode;
  missingBefore: number;
  missingAfter: number;
  earliestAchievementPeriod: string | null;
  reasons: string[];
  warnings: string[];
}

export interface ForecastMonthlyInput {
  period: string;
  registrations: Array<{ course: CourseCode; placementMemberId: string; count: number }>;
  continuationRate: number;
  additionalPv: number;
  teamActivityRate: number;
  introductionsPerActiveMember: number;
  maxTeamRegistrations: number;
}

export interface ForecastScenario {
  id: "conservative" | "standard" | "challenge";
  label: string;
  months: ForecastMonthlyInput[];
  taxProfile: TaxProfile;
}

export interface ForecastResult {
  scenarioId: ForecastScenario["id"];
  assumptionLoad: "low" | "medium" | "high";
  assumptionNotes: string[];
  months: Array<{
    period: string;
    groupMembers: number;
    groupPv: number;
    title: TitleCode;
    gross: number;
    estimatedNet: number;
    directRegistrations: number;
    teamRegistrations: number;
    retainedMembers: number;
  }>;
}

export interface SavedForecast {
  id: string;
  workspaceId: string;
  name: string;
  basePeriod: string;
  rootMemberId: string;
  scenarios: ForecastScenario[];
  results: ForecastResult[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  period: string;
  rootMember: Member;
  groupPv: number;
  groupMembers: number;
  title: TitleEvaluation;
  bonus: BonusBreakdown;
  missions: Mission[];
}
