import type { IdIncome, StrategyMonth } from "./shared/strategy";

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const title = (value: string) => value === "NONE" ? "タイトルなし" : value;

function Difference({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) return null;
  const difference = Math.round(current) - Math.round(previous);
  return <span className={`try-difference ${difference > 0 ? "increase" : difference < 0 ? "decrease" : "unchanged"}`}>
    {difference === 0 ? "±0円（変化なし）" : `${difference > 0 ? "+" : "−"}${yen(Math.abs(difference))}`}
  </span>;
}

function AmountRow({ label, current, previous }: { label: string; current: number; previous?: number }) {
  return <div className="try-amount-row"><dt>{label}</dt><dd><strong>{yen(current)}</strong>
    {previous !== undefined && <><small>直前 {yen(previous)}</small><Difference current={current} previous={previous}/></>}
  </dd></div>;
}

export default function PlaygroundBreakdown({ row, previous }: { row: StrategyMonth; previous?: StrategyMonth }) {
  // Compare the same selected month, never a different point on the timeline.
  const before = previous?.month === row.month ? previous : undefined;
  const ids = [...new Set([...row.ids.map(i => i.id), ...(before?.ids.map(i => i.id) ?? [])])];
  const recurringFields = [["line", "ライン"], ["director", "ディレクター"], ["titleBonus", "タイトル"]] as const;
  const oneTimeFields = [["start", "スタート"], ["trainerBonus", "トレーナー"]] as const;
  function amountRows(fields: ReadonlyArray<readonly [keyof IdIncome, string]>, now?: IdIncome, old?: IdIncome) {
    return <dl className="try-amounts">{fields.map(([key, label]) => <AmountRow key={key} label={label} current={Number(now?.[key] ?? 0)} previous={before ? Number(old?.[key] ?? 0) : undefined}/>)}</dl>;
  }
  return <section className="try-details" aria-label="この月の内訳"><h2>この月の内訳</h2>
    <p className="try-comparison-note">{row.month === 0 ? "現在" : `${Math.floor(row.month / 12)}年${row.month % 12 ? `${row.month % 12}か月` : ""}後`}の金額{before ? " · 直前の操作前と比較（前月比ではありません）" : " · 配置や育て方を変えると、ここにも増減が出ます。"}</p>
    {ids.map(id => {
      const now = row.ids.find(i => i.id === id), old = before?.ids.find(i => i.id === id);
      return <details key={id}><summary><span>{now?.name ?? old!.name}</span><span className="try-id-total">{yen(now?.recurring ?? 0)}／月 <Difference current={now?.recurring ?? 0} previous={before ? old?.recurring ?? 0 : undefined}/></span></summary>
        <p>{old && old.title !== now?.title ? `${title(old.title)} → ` : ""}{now ? title(now.title) : "集計対象外"}</p>
        <h3>継続分</h3>{amountRows(recurringFields, now, old)}
        <h3>一時分（月額には含めません）</h3>{amountRows(oneTimeFields, now, old)}
        <dl className="try-amounts"><AmountRow label="総ボーナス（一時分を含む）" current={now?.gross ?? 0} previous={before ? old?.gross ?? 0 : undefined}/></dl>
      </details>;
    })}
    <h3>自分＋自分のサブの合計</h3>
    <dl className="try-amounts">
      <AmountRow label="継続月額" current={row.recurring} previous={before?.recurring}/>
      <AmountRow label="継続分の概算手取" current={row.recurringNet} previous={before?.recurringNet}/>
      <AmountRow label="所有IDの購入費（差し引く額）" current={row.costs} previous={before?.costs}/>
      <AmountRow label="購入費を引いた参考月額" current={row.recurringCashflow} previous={before?.recurringCashflow}/>
    </dl>
    <h3>TRDまでに足りない条件</h3><ul>{row.missing.map(x => <li key={x}>{x}</li>)}</ul>
  </section>;
}
