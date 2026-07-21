import type {
  Goal,
  Member,
  OrganizationSnapshot,
  PurchaseEvent,
  SimulationMember,
  TaxProfile
} from "../src/shared/types";

interface MemberRow {
  id: string;
  workspace_id: string;
  display_name: string;
  parent_member_id: string | null;
  introducer_member_id: string | null;
  master_member_id: string | null;
  trainer_member_id: string | null;
  id_kind: Member["idKind"];
  course: Member["course"];
  title: Member["title"];
  trainer_credential: Member["trainerCredential"];
  sponsor_license: number;
  director_promoted_period: string | null;
  joined_period: string;
  ended_period: string | null;
}

interface PurchaseRow {
  id: string;
  workspace_id: string;
  member_id: string;
  period: string;
  product_code: string | null;
  kind: PurchaseEvent["kind"];
  status: PurchaseEvent["status"];
  quantity: number;
  price: number;
  pv: number;
}

interface SimulationMemberRow {
  id: string;
  workspace_id: string;
  display_name: string;
  parent_member_id: string;
  introducer_member_id: string;
  course: SimulationMember["course"];
  period: string;
  created_at: string;
}

const mapMember = (row: MemberRow): Member => ({
  id: row.id,
  workspaceId: row.workspace_id,
  displayName: row.display_name,
  parentMemberId: row.parent_member_id,
  introducerMemberId: row.introducer_member_id,
  masterMemberId: row.master_member_id,
  trainerMemberId: row.trainer_member_id,
  idKind: row.id_kind,
  course: row.course,
  title: row.title,
  trainerCredential: row.trainer_credential,
  sponsorLicense: row.sponsor_license === 1,
  directorPromotedPeriod: row.director_promoted_period,
  joinedPeriod: row.joined_period,
  endedPeriod: row.ended_period
});

const mapPurchase = (row: PurchaseRow): PurchaseEvent => ({
  id: row.id,
  workspaceId: row.workspace_id,
  memberId: row.member_id,
  period: row.period,
  productCode: row.product_code,
  kind: row.kind,
  status: row.status,
  quantity: row.quantity,
  price: row.price,
  pv: row.pv
});

const mapSimulationMember = (row: SimulationMemberRow): SimulationMember => ({
  id: row.id,
  workspaceId: row.workspace_id,
  displayName: row.display_name,
  parentMemberId: row.parent_member_id,
  introducerMemberId: row.introducer_member_id,
  course: row.course,
  period: row.period,
  createdAt: row.created_at
});

export async function listSimulationMembers(db: D1Database, workspaceId: string, period: string): Promise<SimulationMember[]> {
  const rows = await db.prepare(
    "SELECT * FROM simulation_members WHERE workspace_id = ? AND period = ? ORDER BY created_at, id"
  ).bind(workspaceId, period).all<SimulationMemberRow>();
  return rows.results.map(mapSimulationMember);
}

export const simulationMemberInsert = (db: D1Database, member: SimulationMember): D1PreparedStatement => db.prepare(
  "INSERT INTO simulation_members (id, workspace_id, display_name, parent_member_id, introducer_member_id, course, period, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
).bind(
  member.id, member.workspaceId, member.displayName, member.parentMemberId, member.introducerMemberId,
  member.course, member.period, member.createdAt
);

export async function loadSnapshot(db: D1Database, workspaceId: string, period: string): Promise<OrganizationSnapshot> {
  const [memberRows, purchaseRows] = await Promise.all([
    db.prepare("SELECT * FROM members WHERE workspace_id = ? ORDER BY created_at, id").bind(workspaceId).all<MemberRow>(),
    db.prepare("SELECT * FROM purchases WHERE workspace_id = ? ORDER BY period, id").bind(workspaceId).all<PurchaseRow>()
  ]);
  return {
    workspaceId,
    period,
    members: memberRows.results.map(mapMember),
    purchases: purchaseRows.results.map(mapPurchase)
  };
}

export async function getGoal(db: D1Database, workspaceId: string): Promise<Goal> {
  const row = await db.prepare("SELECT workspace_id, target_title, target_period FROM goals WHERE workspace_id = ?")
    .bind(workspaceId).first<{ workspace_id: string; target_title: Goal["targetTitle"]; target_period: string }>();
  if (!row) return { workspaceId, targetTitle: "LD", targetPeriod: "2026-12" };
  return { workspaceId: row.workspace_id, targetTitle: row.target_title, targetPeriod: row.target_period };
}

export async function getTaxProfile(db: D1Database, workspaceId: string): Promise<TaxProfile> {
  const row = await db.prepare("SELECT * FROM tax_profiles WHERE workspace_id = ?").bind(workspaceId).first<{
    invoice_registered: number; withholding_rate: number; transfer_fee: number; offsets: number; prior_carryover: number;
  }>();
  return {
    invoiceRegistered: row?.invoice_registered === 1,
    withholdingRate: row?.withholding_rate ?? 0,
    transferFee: row?.transfer_fee ?? 0,
    offsets: row?.offsets ?? 0,
    priorCarryover: row?.prior_carryover ?? 0
  };
}

export async function upsertGoal(db: D1Database, goal: Goal): Promise<void> {
  await db.prepare(
    "INSERT INTO goals (workspace_id, target_title, target_period) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET target_title = excluded.target_title, target_period = excluded.target_period, updated_at = CURRENT_TIMESTAMP"
  ).bind(goal.workspaceId, goal.targetTitle, goal.targetPeriod).run();
}

export async function upsertTaxProfile(db: D1Database, workspaceId: string, profile: TaxProfile): Promise<void> {
  await db.prepare(
    "INSERT INTO tax_profiles (workspace_id, invoice_registered, withholding_rate, transfer_fee, offsets, prior_carryover) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET invoice_registered = excluded.invoice_registered, withholding_rate = excluded.withholding_rate, transfer_fee = excluded.transfer_fee, offsets = excluded.offsets, prior_carryover = excluded.prior_carryover, updated_at = CURRENT_TIMESTAMP"
  ).bind(workspaceId, profile.invoiceRegistered ? 1 : 0, profile.withholdingRate, profile.transferFee, profile.offsets, profile.priorCarryover).run();
}

export const memberInsert = (db: D1Database, member: Member): D1PreparedStatement => db.prepare(
  "INSERT INTO members (id, workspace_id, display_name, parent_member_id, introducer_member_id, master_member_id, trainer_member_id, id_kind, course, title, trainer_credential, sponsor_license, director_promoted_period, joined_period, ended_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
).bind(
  member.id, member.workspaceId, member.displayName, member.parentMemberId, member.introducerMemberId,
  member.masterMemberId, member.trainerMemberId, member.idKind, member.course, member.title,
  member.trainerCredential, member.sponsorLicense ? 1 : 0, member.directorPromotedPeriod, member.joinedPeriod, member.endedPeriod
);

export const purchaseInsert = (db: D1Database, purchase: PurchaseEvent): D1PreparedStatement => db.prepare(
  "INSERT INTO purchases (id, workspace_id, member_id, period, product_code, kind, status, quantity, price, pv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
).bind(
  purchase.id, purchase.workspaceId, purchase.memberId, purchase.period, purchase.productCode, purchase.kind,
  purchase.status, purchase.quantity, purchase.price, purchase.pv
);
