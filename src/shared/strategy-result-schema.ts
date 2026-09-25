import { z } from "zod";
import { TITLE_ORDER } from "./types";
import { actionSchema, CHECKPOINTS, STRATEGY_VERSION, type StrategySimulationResult } from "./strategy";

const amount = z.number().finite();
const count = z.number().int().min(0).max(100000);
const id = z.string().min(1).max(120);
const title = z.enum(TITLE_ORDER);
const node = z.object({ id, name: z.string().max(80), parentId: id.nullable(), introducerId: id.nullable(), ownerId: id.nullable(), course: z.string().max(5), title, count, active: count, depth: count });
const income = z.object({ id, name: z.string().max(80), ownerId: id, title, acquiredTitle: title, trainer: z.string().max(20),
  start: amount, trainerBonus: amount, line: amount, director: amount, titleBonus: amount, gross: amount, recurring: amount, cost: amount });
const bonus = z.object({ start: amount, trainer: amount, line: amount, director: amount, title: amount, gross: amount, estimatedNet: amount, carryover: amount,
  deductions: z.object({ invoiceTransition: amount, withholding: amount, transferFee: amount, offsets: amount }) });
const row = z.object({ month: count, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), count, enrolled: count, inactive: count, exited: count, ownedSubs: count, pv: amount,
  targetTitle: title, missing: z.array(z.string().max(500)).max(50), gross: amount, recurring: amount, recurringNet: amount, recurringCashflow: amount, line: amount, net: amount, costs: amount, cashflow: amount, cumulative: amount,
  ids: z.array(income).max(12), payees: z.array(z.object({ id, bonus })).max(2), changes: z.array(z.string().max(500)).max(200) });
const candidate = z.object({ id, label: z.string().max(200), placements: z.record(id, id), introducers: z.record(id, id), directPlacements: z.record(id, z.array(id).min(1).max(12)), actions: z.array(actionSchema).max(120) });
const variant = z.object({ candidate, band: z.enum(["conservative", "standard", "challenge"]), months: z.array(row).min(1).max(12013),
  checkpoints: z.array(z.object({ memberCount: count, reached: z.boolean(), reachedMonth: count.nullable(), actualCount: count, remaining: count, snapshot: row.nullable(), organization: z.array(node).max(5000) })).length(6),
  status: z.enum(["reached", "horizon", "stalled", "missing-assumptions"]), titleMonth: count.nullable(), completionMonth: count.nullable(),
  finalOrganization: z.array(node).max(5000), completion: row.nullable(), steady: row.nullable(), postCompletionAverage: amount.nullable(), maintenanceFailures: count,
  referenceArrivalMonth: z.number().int().nonnegative().nullable(), recentMonthlyGrowth: amount,
  warnings: z.array(z.string().max(1000)).max(100), pendingActions: z.array(id).max(120),
  finalDesign: z.object({ target: count, allocated: count, remaining: count, fixedMembers: count, lines: z.array(z.object({ leaderId: id, parentId: id, quota: count })).max(12) })
});
export const strategyResultSchema: z.ZodType<StrategySimulationResult> = z.object({ engineVersion: z.literal(STRATEGY_VERSION), planVersion: z.string().max(200), fingerprint: z.string().max(100), explored: count, comparisonMonth: count,
  stressImpact: z.array(z.object({ objective: z.enum(["fastest", "income", "balanced"]), band: z.enum(["conservative", "standard", "challenge"]), month: count, countDelta: amount, recurringDelta: amount, cumulativeDelta: amount })).max(9),
  variants: z.array(z.object({ objective: z.enum(["fastest", "income", "balanced"]), candidateId: id, bands: z.object({ conservative: variant, standard: variant, challenge: variant }) })).length(3),
  crossovers: z.array(z.object({ left: z.enum(["fastest", "income", "balanced"]), right: z.enum(["fastest", "income", "balanced"]), month: count.nullable() })).length(3)
}).superRefine((result, context) => {
  if (new Set(result.variants.map((v) => v.objective)).size !== 3) context.addIssue({ code: "custom", message: "戦略の種類が重複しています" });
  for (const v of result.variants) for (const [band, r] of Object.entries(v.bands)) {
    if (r.band !== band || r.candidate.id !== v.candidateId || r.months.some((m, i) => m.month !== i)) context.addIssue({ code: "custom", message: "月次結果と戦略の対応が一致しません" });
    if (r.checkpoints.some((c, i) => c.memberCount !== CHECKPOINTS[i] || (c.reached && (c.reachedMonth === null || c.snapshot?.month !== c.reachedMonth || c.snapshot.count < c.memberCount || c.actualCount !== c.snapshot.count))))
      context.addIssue({ code: "custom", message: "チェックポイントが一致しません" });
    for (const m of r.months) {
      const sum = (key: "gross" | "recurring" | "cost") => m.ids.reduce((total, id) => total + id[key], 0);
      if (Math.abs(m.gross - sum("gross")) > 0.00001 || Math.abs(m.recurring - sum("recurring")) > 0.00001 || Math.abs(m.costs - sum("cost")) > 0.00001 ||
        Math.abs(m.cashflow - (m.net - m.costs)) > 0.00001 || Math.abs(m.recurringCashflow - (m.recurringNet - m.costs)) > 0.00001 ||
        new Set(m.ids.map((id) => id.id)).size !== m.ids.length || new Set(m.payees.map((p) => p.id)).size !== m.payees.length)
        context.addIssue({ code: "custom", message: "金額内訳と合計が一致しません" });
    }
  }
});
