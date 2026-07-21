export const COURSES = ["A", "B", "F", "G", "I"] as const;
export type CourseCode = (typeof COURSES)[number];

export const TITLE_ORDER = ["NONE", "LD", "LL", "DR", "SD", "TD", "TRD"] as const;
export type TitleCode = (typeof TITLE_ORDER)[number];
export type TrainerCredential = "NONE" | "PT" | "ST";
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

export interface Prospect {
  id: string;
  workspaceId: string;
  name: string;
  ageBand: string;
  introducerMemberId: string | null;
  temperature: 1 | 2 | 3 | 4 | 5;
  interestTags: string[];
  firstContactDate: string | null;
  productExperience: boolean;
  briefingAttended: boolean;
  registrationStatus: "lead" | "following" | "ready" | "registered" | "paused";
  nextActionDate: string | null;
  notes: string;
}

export interface ActivityEvent {
  id: string;
  workspaceId: string;
  prospectId: string | null;
  memberId: string | null;
  activityType: "contact" | "experience" | "briefing" | "followup" | "registration" | "memo";
  occurredAt: string;
  nextActionDate: string | null;
  note: string;
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
  category: "followup" | "title" | "schedule" | "data";
  title: string;
  reason: string;
  dueDate: string | null;
}

export interface SimulationRequest {
  prospectId?: string;
  candidateName: string;
  course: CourseCode;
  period: string;
  targetTitle: TitleCode;
  placementCandidateIds?: string[];
  taxProfile: TaxProfile;
}

export interface PlacementResult {
  placementMemberId: string;
  placementMemberName: string;
  eligible: boolean;
  rank: number | null;
  grossDelta: number;
  estimatedNetDelta: number;
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
}

export interface ForecastScenario {
  id: "conservative" | "standard" | "challenge";
  label: string;
  months: ForecastMonthlyInput[];
  taxProfile: TaxProfile;
}

export interface ForecastResult {
  scenarioId: ForecastScenario["id"];
  months: Array<{
    period: string;
    groupMembers: number;
    groupPv: number;
    title: TitleCode;
    gross: number;
    estimatedNet: number;
  }>;
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
