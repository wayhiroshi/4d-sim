import { z } from "zod";

export const manualPurchaseSchema = z.object({
  kind: z.enum(["initial", "repeat", "additional"]),
  pv: z.number().int().nonnegative(),
  price: z.number().int().nonnegative()
});
export type ManualPurchase = z.infer<typeof manualPurchaseSchema>;

export function readManualPurchase(values: FormData): ManualPurchase | undefined {
  const pv = String(values.get("purchasePv") ?? "").trim();
  const price = String(values.get("purchasePrice") ?? "").trim();
  if (!pv && !price) return undefined;
  if (!pv) throw new Error("購入額を入力した場合はp.v.も入力してください");
  const result = manualPurchaseSchema.safeParse({ kind: values.get("purchaseKind"), pv: Number(pv), price: price ? Number(price) : 0 });
  if (!result.success) throw new Error("p.v.・購入額は0以上の整数で入力してください");
  return result.data;
}
