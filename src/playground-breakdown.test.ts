import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import PlaygroundBreakdown from "./PlaygroundBreakdown";
import type { StrategyMonth } from "./shared/strategy";

function month(): StrategyMonth {
  return { month: 120, period: "2036-09", count: 100, enrolled: 100, inactive: 0, exited: 0, ownedSubs: 1, pv: 533000,
    targetTitle: "LD", missing: [], gross: 3200, recurring: 2200, recurringNet: 2100, costs: 1000, recurringCashflow: 1100, line: 2000, net: 3100, cashflow: 2100, cumulative: 0,
    ids: [{ id: "self", name: "自分", ownerId: "self", title: "LD", acquiredTitle: "LD", trainer: "NONE", start: 1000, trainerBonus: 0, line: 2000, director: 200, titleBonus: 0, gross: 3200, recurring: 2200, cost: 1000 }], payees: [], changes: [] };
}
const render = (row: StrategyMonth, previous?: StrategyMonth) => renderToStaticMarkup(createElement(PlaygroundBreakdown, { row, previous }));

it("shows signed per-bonus differences and separates temporary bonuses from recurring income", () => {
  const previous = month(), row = month();
  Object.assign(row.ids[0]!, { line: 2400, director: 100, start: 600, trainerBonus: 50, recurring: 2500, gross: 3150 });
  const html = render(row, previous);
  expect(html).toContain("+400円"); expect(html).toContain("−100円");
  expect(html).toContain("+300円"); expect(html).toContain("−400円");
  expect(html).toContain("+50円"); expect(html).toContain("±0円（変化なし）");
  expect(html).toContain("直前 "); expect(html).toContain("2,000円");
  expect(html).toContain("一時分（月額には含めません）");
  expect(html).toContain("前月比ではありません");
});
it("shows no made-up delta before an operation or when the comparison month differs", () => {
  for (const previous of [undefined, {...month(),month:12}]) {
    const html = render(month(), previous);
    expect(html).not.toContain("try-difference");
    expect(html).toContain("配置や育て方を変えると");
  }
});
it("matches income by ID and shows removed IDs as zero rather than losing their decrease", () => {
  const previous = month(), row = month();
  row.ids = [];
  const html = render(row,previous);
  expect(html).toContain("自分"); expect(html).toContain("集計対象外"); expect(html).toContain("−2,200円");
  expect(render(previous,row)).toContain("+2,200円");
});
it("compares net income, purchase costs and cashflow independently, and reverses signs on undo", () => {
  const previous = month(), row = month();
  row.recurringNet += 500; row.costs += 150; row.recurringCashflow += 350;
  const html = render(row,previous), undo = render(previous,row);
  for (const n of [500,150,350]) { expect(html).toContain(`+${n}円`); expect(undo).toContain(`−${n}円`); }
  expect(html).toContain("所有IDの購入費（差し引く額）");
});
