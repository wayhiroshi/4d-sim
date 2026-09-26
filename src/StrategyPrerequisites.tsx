import { useState, type FormEvent } from "react";
import { scheduleTitlePrerequisites, titlePrerequisites } from "./domain/strategy-prerequisites";
import type { OrganizationSnapshot } from "./shared/types";
import type { StrategySimulationRequest } from "./shared/strategy";

export default function StrategyPrerequisites({ base, input, busy, apply, settings }: {
  base: OrganizationSnapshot; input: StrategySimulationRequest; busy: boolean;
  apply: (next: StrategySimulationRequest) => void; settings: () => void;
}) {
  const [editing, setEditing] = useState(false), [error, setError] = useState("");
  const issues = titlePrerequisites(base, input), blocked = issues.filter(i => i.scheduledMonth === null), scheduled = issues.filter(i => i.scheduledMonth !== null);
  if (!issues.length) return null;
  const quick = blocked.filter(i => i.canAdd);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try {
      const course = values.get("course") === "B" ? "B" : "G";
      apply(scheduleTitlePrerequisites(base, input, Number(values.get("month")), course)); setEditing(false); setError("");
    } catch (reason) { setError((reason as Error).message); }
  }
  return <section className={`canvas-prerequisites ${blocked.length ? "blocked" : "planned"}`} aria-label="タイトル取得の前提">
    {blocked.length > 0 && <>
      <div role="alert"><strong>この前提のままでは、人数が増えてもDRに進めません</strong>
        <ul>{blocked.map(i => <li key={`${i.memberId}-${i.kind}`}>{i.name}：{i.label}{i.canAdd ? "の予定がありません" : "の予定を見直してください（条件付き・期間外など）"}</li>)}</ul>
      </div>
      {quick.length > 0 && !editing && <button className="canvas-primary" disabled={busy} onClick={() => setEditing(true)}>途中で条件を満たす予定を設定</button>}
      {blocked.some(i => !i.canAdd) && <button disabled={busy} onClick={settings}>設定済みの予定を確認</button>}
      {editing && <form onSubmit={submit}>
        <label>何か月後に条件を満たしますか？<input name="month" type="number" min="1" max={input.horizonMonths} step="1" defaultValue="1" required /></label>
        {quick.some(i => i.kind === "change-course") && <label>変更後のコース<select name="course" defaultValue="G"><option value="G">Gコース</option><option value="B">Bコース</option></select></label>}
        <p>上記の未設定項目を試算上の予定として追加します。変更後のコースのp.v.・購入費も再計算します。実組織の登録情報は変わりません。</p>
        <div><button className="canvas-primary" disabled={busy}>この予定で再計算</button> <button type="button" disabled={busy} onClick={() => setEditing(false)}>キャンセル</button></div>
        {error && <p role="alert">{error}</p>}
      </form>}
    </>}
    {scheduled.length > 0 && <div className="canvas-planned-qualifications"><strong>将来の取得予定を含めた試算</strong><ul>{scheduled.map(i => <li key={`${i.memberId}-${i.kind}`}>{i.name}：{i.scheduledMonth}か月後に{i.kind === "change-course" ? `${i.course}コースへ変更` : i.label}</li>)}</ul><button disabled={busy} onClick={settings}>予定を変更</button></div>}
  </section>;
}
