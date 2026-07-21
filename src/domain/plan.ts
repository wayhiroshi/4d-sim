import { z } from "zod";
import rawPlan from "../../config/plans/fordays-2026-03.json";
import { COURSES, TITLE_ORDER, type PlanConfig } from "../shared/types";

const courseCode = z.enum(COURSES);
const titleCode = z.enum(TITLE_ORDER);
const product = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  pv: z.number().nonnegative(),
  conversion: z.number().nonnegative(),
  category: z.enum(["drink", "supplement", "cosmetic", "other"]),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable()
});

const course = z.object({
  code: courseCode,
  recurringPv: z.number().positive(),
  startBonus: z.number().nonnegative(),
  maxBaseDepth: z.number().int().positive(),
  baseLineRates: z.array(z.number().min(0).max(1))
});

const planSchema = z.object({
  planId: z.string().min(1),
  version: z.string().min(1),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable(),
  businessMonthStartDay: z.number().int().min(1).max(28),
  firstLineLimit: z.number().int().positive(),
  compression: z.object({ enabled: z.boolean(), promoteEndedMembers: z.boolean(), firstLineMayExceedLimit: z.boolean() }),
  courses: z.record(courseCode, course),
  products: z.array(product),
  titles: z.array(z.object({
    code: z.enum(["LD", "LL", "DR", "SD", "TD", "TRD"]),
    label: z.string(),
    rank: z.number().int().positive(),
    titleBonusRate: z.number().min(0).max(1),
    sameRankRates: z.array(z.number().min(0).max(1)),
    directIntroductions: z.number().int().nonnegative(),
    groupMembers: z.number().int().nonnegative().nullable(),
    groupPv: z.number().nonnegative().nullable(),
    requiredDirectTitle: titleCode.nullable(),
    requiredDirectTitleCount: z.number().int().nonnegative()
  })),
  ld: z.object({
    firstLineActive: z.number().int().positive(),
    secondLineActive: z.number().int().positive(),
    directActive: z.number().int().positive()
  }),
  director: z.object({
    directActive: z.number().int().positive(),
    pattern1: z.object({
      first: z.number().int().positive(),
      second: z.number().int().positive(),
      third: z.number().int().positive(),
      rollingTwoMonthPv: z.number().positive()
    }),
    pattern2: z.object({
      firstTwoLineTotal: z.number().int().positive(),
      currentPv: z.number().positive(),
      rollingTwoMonthPv: z.number().positive()
    }),
    maintenancePv: z.number().positive(),
    promotionFollowingMonthMaintenanceException: z.boolean(),
    pattern2ExcludesSevenOrMoreIds: z.boolean()
  }),
  lineRatesByTitle: z.partialRecord(
    titleCode,
    z.partialRecord(courseCode, z.array(z.number().min(0).max(1)))
  ),
  tax: z.object({
    paymentCarryoverThreshold: z.number().nonnegative(),
    invoiceTransitions: z.array(z.object({
      from: z.iso.date(),
      to: z.iso.date(),
      disallowedInputTaxRate: z.number().min(0).max(1)
    }))
  }),
  sources: z.array(z.object({ name: z.string(), revision: z.string(), pages: z.string() }))
});

export const planConfig: PlanConfig = planSchema.parse(rawPlan);

export function getProduct(code: string) {
  return planConfig.products.find((item) => item.code === code) ?? null;
}
