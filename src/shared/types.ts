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

export interface ShoppingMallProductRule {
  code: string;
  memberProductCode: string;
  name: string;
  normalPrice: number;
  memberPrice: number;
  standardPv: number;
  priceVerifiedOn: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PlanConfig {
  planId: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  businessMonthStartDay: number;
  firstLineLimit: number;
  maxSubIdsPerMaster: number;
  compression: { enabled: boolean; promoteEndedMembers: boolean; firstLineMayExceedLimit: boolean };
  courses: Record<CourseCode, CourseRule>;
  trainerBonuses: Record<CourseCode, Record<TrainerBonusRole, number>>;
  trainerQualifications: Record<Exclude<TrainerCredential, "NONE">, {
    label: string;
    rank: number;
    requiredTitle: TitleCode | null;
    requiredTrainerCredential: TrainerCredential | null;
    directIntroductions: number;
    requiredDirectTitle: TitleCode | null;
    requiredDirectTitleCount: number;
    openStudioAttendances: number;
    requiresSponsorLicense: boolean;
    courseField: "preTrainerCourseCompleted" | "startTrainerCourseCompleted";
    kitField: "preTrainerKitPurchased" | "startTrainerKitPurchased";
  }>;
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
  shoppingMallInvitation: {
    effectiveFrom: string;
    issueFeePerId: number;
    maxUplineDepth: number;
    creditDelayDays: number;
    products: ShoppingMallProductRule[];
  };
  tax: {
    paymentCarryoverThreshold: number;
    invoiceTransitions: Array<{ from: string; to: string; disallowedInputTaxRate: number }>;
  };
  sources: Array<{ name: string; revision: string; pages: string }>;
}

export interface ShoppingMallInvitationEstimate {
  productCode: string;
  productName: string;
  course: CourseCode;
  title: TitleCode;
  orders: number;
  standardPvPerOrder: number;
  creditedPv: number;
  firstLineRate: number;
  salesBonusPerOrder: number;
  pvBonusPerOrder: number;
  grossBonusPerOrder: number;
  salesBonus: number;
  pvBonus: number;
  grossBonus: number;
  issueFee: number;
  afterIssueFee: number;
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
  openStudioAttendances: number;
  preTrainerCourseCompleted: boolean;
  preTrainerKitPurchased: boolean;
  startTrainerCourseCompleted: boolean;
  startTrainerKitPurchased: boolean;
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
  masterMemberId: string | null;
  trainerMemberId: string | null;
  trainerBonusRole: TrainerBonusRole | null;
  idKind: IdKind;
  course: CourseCode;
  period: string;
  createdAt: string;
}

export interface SimulationOrganization {
  snapshot: OrganizationSnapshot;
  simulationMembers: SimulationMember[];
  bonusComparison: {
    actual: BonusBreakdown;
    simulated: BonusBreakdown;
    delta: PlacementBonusDelta;
    actualOwnedIdCount: number;
    simulatedOwnedIdCount: number;
  };
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

export interface TrainerQualificationChecklistItem {
  code: Exclude<TrainerCredential, "NONE">;
  label: string;
  rank: number;
  status: "achieved" | "next" | "future";
  progress: number;
  conditions: ConditionResult[];
  bonuses: Array<{ courseLabel: string; solo: number; withPreTrainer: number | null }>;
}

export interface TrainerQualificationProfile {
  memberId: string;
  trainerCredential: TrainerCredential;
  sponsorLicense: boolean;
  openStudioAttendances: number;
  preTrainerCourseCompleted: boolean;
  preTrainerKitPurchased: boolean;
  startTrainerCourseCompleted: boolean;
  startTrainerKitPurchased: boolean;
}

export interface TitleChecklistData {
  period: string;
  achievedTitle: TitleCode;
  planVersion: string;
  titles: TitleChecklistItem[];
  trainerQualifications: TrainerQualificationChecklistItem[];
  trainerProfile: TrainerQualificationProfile;
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
  idKind: IdKind;
  period: string;
  targetTitle: TitleCode;
  placementCandidateIds?: string[];
  trainerBonusRole?: TrainerBonusRole | null;
  incomeMode?: "self" | "pair";
  partnerMemberId?: string | null;
  taxProfile: TaxProfile;
}

export interface BatchSimulationRequest extends SimulationRequest {
  candidateCount: number;
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

export interface PlacementIncomeOwner {
  memberId: string;
  memberName: string;
  before: BonusBreakdown;
  after: BonusBreakdown;
  delta: PlacementBonusDelta;
}

export interface PlacementIncomeComparison {
  mode: "self" | "pair";
  self: PlacementIncomeOwner;
  partner: PlacementIncomeOwner | null;
  combined: {
    beforeGross: number;
    afterGross: number;
    grossDelta: number;
    beforeEstimatedNet: number;
    afterEstimatedNet: number;
    estimatedNetDelta: number;
  };
}

export interface PlacementResult {
  placementMemberId: string;
  placementMemberName: string;
  eligible: boolean;
  rank: number | null;
  grossDelta: number;
  estimatedNetDelta: number;
  bonusDelta: PlacementBonusDelta;
  incomeComparison: PlacementIncomeComparison;
  titleBefore: TitleCode;
  titleAfter: TitleCode;
  missingBefore: number;
  missingAfter: number;
  earliestAchievementPeriod: string | null;
  ownedIdCountBefore: number;
  ownedIdCountAfter: number;
  reasons: string[];
  warnings: string[];
}

export interface BatchPlacementStep {
  sequence: number;
  candidateMemberId: string;
  candidateName: string;
  placementMemberId: string;
  placementMemberName: string;
  titleBefore: TitleCode;
  titleAfter: TitleCode;
  missingBefore: number;
  missingAfter: number;
  grossDelta: number;
  lineDelta: number;
  estimatedNetDelta: number;
}

export interface BatchSimulationResult {
  strategy: "sequential";
  requestedCount: number;
  placedCount: number;
  unplacedCount: number;
  steps: BatchPlacementStep[];
  titleBefore: TitleCode;
  titleAfter: TitleCode;
  missingBefore: number;
  missingAfter: number;
  ownedIdCountBefore: number;
  ownedIdCountAfter: number;
  bonusDelta: PlacementBonusDelta;
  incomeComparison: PlacementIncomeComparison;
  warnings: string[];
}

export interface BatchSimulationMemberInput {
  tempId: string;
  displayName: string;
  parentMemberId: string;
  course: CourseCode;
  period: string;
  idKind: IdKind;
  trainerBonusRole: TrainerBonusRole | null;
}

export interface ForecastMonthlyInput {
  period: string;
  registrations: Array<{ course: CourseCode; placementMemberId: string; count: number; trainerBonusRole?: TrainerBonusRole | null }>;
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
    ownedIdCount: number;
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
  ownedIdCount: number;
  missions: Mission[];
}
