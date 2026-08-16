import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near: ${key ?? ""}`);
    values[key.slice(2)] = value;
  }
  return values;
}

function ratesFor(plan, course, title) {
  const configured = plan.lineRatesByTitle[title]?.[course];
  if (configured) return configured;
  const titleOrder = ["NONE", "LD", "LL", "DR", "SD", "TD", "TRD"];
  if (titleOrder.indexOf(title) >= titleOrder.indexOf("DR")) {
    const director = plan.lineRatesByTitle.DR?.[course];
    if (director) return director;
  }
  if (titleOrder.indexOf(title) >= titleOrder.indexOf("LD")) {
    const ld = plan.lineRatesByTitle.LD?.[course];
    if (ld) return ld;
  }
  return plan.courses[course]?.baseLineRates ?? [];
}

function yen(value) {
  return `${new Intl.NumberFormat("ja-JP").format(value)}円`;
}

function buildForecast(plan, options) {
  const product = plan.shoppingMallInvitation.products.find((item) => item.code === options.productCode);
  if (!product) throw new Error(`Shopping mall product not found: ${options.productCode}`);
  if (!plan.courses[options.course]) throw new Error(`Course not found: ${options.course}`);
  const firstLineRate = ratesFor(plan, options.course, options.title)[0] ?? 0;
  const salesBonusPerOrder = product.normalPrice - product.memberPrice;
  const pvBonusPerOrder = Math.round(product.standardPv * firstLineRate);
  const grossBonusPerOrder = salesBonusPerOrder + pvBonusPerOrder;
  let cumulativeOrders = 0;
  let cumulativeGross = 0;
  const months = options.orders.map((orders, index) => {
    if (!Number.isInteger(orders) || orders < 0) throw new Error(`Orders must be non-negative integers: ${orders}`);
    cumulativeOrders += orders;
    const grossBonus = grossBonusPerOrder * orders;
    cumulativeGross += grossBonus;
    return {
      month: `M${index + 1}`,
      orders,
      cumulativeOrders,
      salesBonus: salesBonusPerOrder * orders,
      pvBonus: pvBonusPerOrder * orders,
      grossBonus,
      cumulativeGross
    };
  });
  const totalOrders = options.orders.reduce((sum, orders) => sum + orders, 0);
  const issueFee = options.includeIssueFee ? plan.shoppingMallInvitation.issueFeePerId : 0;

  return {
    planId: plan.planId,
    planVersion: plan.version,
    product: {
      code: product.code,
      name: product.name,
      normalPrice: product.normalPrice,
      memberPrice: product.memberPrice,
      standardPv: product.standardPv,
      priceVerifiedOn: product.priceVerifiedOn
    },
    assumptions: {
      course: options.course,
      title: options.title,
      firstLineRate,
      activeRecurringPurchaseRequired: true,
      issueFee
    },
    perOrder: {
      salesBonus: salesBonusPerOrder,
      pvBonus: pvBonusPerOrder,
      grossBonus: grossBonusPerOrder
    },
    months,
    totals: {
      orders: totalOrders,
      creditedPv: product.standardPv * totalOrders,
      salesBonus: salesBonusPerOrder * totalOrders,
      pvBonus: pvBonusPerOrder * totalOrders,
      grossBonus: grossBonusPerOrder * totalOrders,
      issueFee,
      afterIssueFee: grossBonusPerOrder * totalOrders - issueFee
    }
  };
}

function toMarkdown(result) {
  const lines = [
    `# ${result.product.name} 招待販売試算`,
    "",
    `- 報酬プラン: ${result.planVersion}`,
    `- コース: ${result.assumptions.course}`,
    `- タイトル: ${result.assumptions.title}`,
    `- 標準換算p.v.: ${result.product.standardPv.toLocaleString("ja-JP")}p.v./件`,
    `- 1次ライン率: ${(result.assumptions.firstLineRate * 100).toFixed(0)}%`,
    `- 1件: 販売ボーナス ${yen(result.perOrder.salesBonus)} + p.v.分 ${yen(result.perOrder.pvBonus)} = ${yen(result.perOrder.grossBonus)}`,
    "",
    "| 月 | 注文 | 累計 | 販売ボーナス | p.v.分 | 月間合計 | 累計報酬 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...result.months.map((month) =>
      `| ${month.month} | ${month.orders} | ${month.cumulativeOrders} | ${yen(month.salesBonus)} | ${yen(month.pvBonus)} | ${yen(month.grossBonus)} | ${yen(month.cumulativeGross)} |`
    ),
    "",
    `年間合計: ${result.totals.orders}件、${result.totals.creditedPv.toLocaleString("ja-JP")}p.v.、総ボーナス ${yen(result.totals.grossBonus)}、発行手数料反映後 ${yen(result.totals.afterIssueFee)}`,
    "",
    "※本人の当月定期購入、返品・取消、インボイス経過措置、源泉徴収、振込手数料、その他相殺は別途反映します。正式額は公式明細を優先します。"
  ];
  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const planPath = path.resolve(root, args.plan ?? "config/plans/fordays-2026-03.json");
const plan = JSON.parse(await readFile(planPath, "utf8"));
const result = buildForecast(plan, {
  productCode: args.product ?? "SHOP-005510",
  course: args.course ?? "A",
  title: args.title ?? "NONE",
  orders: (args.orders ?? "0,1,2,4,6,8,10,12,14,17,21,25").split(",").map(Number),
  includeIssueFee: args["include-issue-fee"] !== "false"
});

if ((args.format ?? "markdown") === "json") {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(toMarkdown(result));
}
