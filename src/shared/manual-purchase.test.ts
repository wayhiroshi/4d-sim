import { describe, expect, it } from "vitest";
import { readManualPurchase } from "./manual-purchase";

const values = (pv: string, price = "") => { const data = new FormData(); data.set("purchasePv", pv); data.set("purchasePrice", price); data.set("purchaseKind", "repeat"); return data; };
describe("manual purchase input", () => {
  it("keeps empty different from explicitly entered zero", () => {
    expect(readManualPurchase(values(""))).toBeUndefined();
    expect(readManualPurchase(values("0"))).toEqual({ kind: "repeat", pv: 0, price: 0 });
    expect(readManualPurchase(values("5330", "9950"))).toEqual({ kind: "repeat", pv: 5330, price: 9950 });
  });
  it("rejects missing PV with price, negatives and fractions", () => {
    for (const data of [values("", "9950"), values("-1"), values("1.5"), values("no"), values("5330", "-1")]) expect(() => readManualPurchase(data)).toThrow();
  });
});
