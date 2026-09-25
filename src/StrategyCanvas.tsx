import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BANDS, CHECKPOINTS, defaultPhase, type Band, type LeaderGrowthProfile, type StrategySimulationRequest, type StrategySimulationResult, type StrategyMonth } from "./shared/strategy";
import type { OrganizationSnapshot } from "./shared/types";
import { movePlacement, placementError, placementNodes } from "./domain/strategy-placement";
import { comparisonPoint, incomeDifferences, sameGrowthAssumptions, type ComparisonBasis } from "./domain/strategy-comparison";
import { Income } from "./StrategyStudio";
import TeamPotentialField from "./TeamPotentialField";
import OrganizationResultTree from "./OrganizationResultTree";
import "./strategy-canvas.css";

const yen = (v: number) => `${Math.round(v).toLocaleString("ja-JP")}円`;
const time = (m: number | null | undefined) => m == null ? "計算期間内では未到達" : m === 0 ? "現在" : `${m >= 12 ? `${Math.floor(m / 12)}年` : ""}${m % 12 ? `${m % 12}か月` : ""}`;
const bandNames = { conservative: "保守", standard: "標準", challenge: "挑戦" };
function NumberField({ value, min, max, disabled, change }: { value: number; min: number; max: number; disabled: boolean; change: (n: number) => void }) {
  return <input key={value} type="number" defaultValue={value} min={min} max={max} disabled={disabled} onBlur={e => {
    const n = Number(e.target.value);
    if (!e.target.value || !Number.isInteger(n) || n < min || n > max) { e.target.value = String(value); return; }
    if (n !== value) change(n);
  }}/>;
}
export type Comparison = { input: StrategySimulationRequest; result: StrategySimulationResult; base: OrganizationSnapshot };
interface Props {
  base: OrganizationSnapshot; input: StrategySimulationRequest; result: StrategySimulationResult | null; busy: boolean; dirty: boolean;
  band: Band; setBand: (band: Band) => void;
  change: (input: StrategySimulationRequest) => void; compute: (input?: StrategySimulationRequest) => void;
  settings: () => void; saved: () => void; save: () => void; saving: boolean; cancel: () => void;
  addTeam: (kind: string) => void;
  reference: Comparison | null; setReference: (reference: Comparison | null) => void;
}

export default function StrategyCanvas(p: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragSource = useRef<string | null>(null);
  const pointerDrag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const baseline = p.reference;
  const setBaseline = p.setReference;
  const [basis, setBasis] = useState<ComparisonBasis>("title");
  const [comparisonCount, setComparisonCount] = useState(500);
  const [comparisonMonth, setComparisonMonth] = useState(60);
  const [history, setHistory] = useState<StrategySimulationRequest[]>([]);
  const [viewBefore, setViewBefore] = useState(false);
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const started = useRef(false);
  const source = useRef(p.base);
  useEffect(() => { if (!started.current) { started.current = true; if (!p.result) p.compute(); } });
  useEffect(() => { if (source.current !== p.base) { source.current = p.base; setHistory([]); setViewBefore(false); } }, [p.base]);
  const input = viewBefore && baseline ? baseline.input : p.input;
  const result = viewBefore && baseline ? baseline.result : p.result;
  const variant = result?.variants[0]?.bands[p.band];
  const previous = baseline?.result.variants[0]?.bands[p.band];
  const stale = !viewBefore && (p.busy || p.dirty);
  const displayBase = viewBefore && baseline ? baseline.base : p.base;
  const nodes = placementNodes(displayBase, input);
  const active = nodes.find(n => n.id === selected);
  const leader = input.leaders.find(l => l.id === active?.leaderId);
  const endpoint = !stale && input.goalBasis === "title" ? variant?.steady : null;
  const outcome = stale ? null : endpoint ?? variant?.months.at(-1);
  const beforeEndpoint = baseline?.input.goalBasis === "title" ? previous?.steady : null;
  const beforeOutcome = endpoint ? beforeEndpoint : previous?.months.find(m => m.month === outcome?.month);
  const chosenCheckpoint = checkpoint === null ? null : variant?.checkpoints.find(c => c.memberCount === checkpoint);
  const stageRow = checkpoint === 0 ? variant?.months[0] : chosenCheckpoint?.snapshot;
  const stageNodes = checkpoint === 0 ? null : chosenCheckpoint?.organization;
  const baselineStage = checkpoint === 0 ? previous?.months[0] : previous?.checkpoints.find(c => c.memberCount === checkpoint)?.snapshot;
  const sameInputs = !!baseline && baseline.result.engineVersion === p.result?.engineVersion && baseline.result.planVersion === p.result?.planVersion && JSON.stringify(baseline.base) === JSON.stringify(p.base) && sameGrowthAssumptions(baseline.input, p.input);
  const comparisonValue = basis === "month" ? comparisonMonth : comparisonCount;
  const comparisonA = baseline ? comparisonPoint(previous, baseline.input, basis, comparisonValue) : null;
  const comparisonB = stale ? null : comparisonPoint(variant, input, basis, comparisonValue);
  const comparableTitle = !baseline || basis !== "title" || (baseline.input.targetTitle === input.targetTitle && baseline.input.targetId === input.targetId);
  function commit(next: StrategySimulationRequest) {
    if (p.busy || viewBefore) return;
    if (!baseline && p.result && !p.dirty) setBaseline({ input: structuredClone(p.input), result: p.result, base: p.base });
    setHistory(h => [...h.slice(-19), structuredClone(p.input)]);
    setError(""); p.change(next); p.compute(next);
  }
  function move(id: string, parent: string) {
    try { commit(movePlacement(p.base, p.input, id, parent)); setMoveTarget(""); }
    catch (e) { setError((e as Error).message); }
    setDragging(null); setHover(null);
  }
  function updateLeader(patch: Partial<LeaderGrowthProfile>) {
    if (leader) commit({ ...p.input, leaders: p.input.leaders.map(l => l.id === leader.id ? { ...l, ...patch } : l) });
  }
  const delta = (row: StrategyMonth | null | undefined, before: StrategyMonth | null | undefined) => row && before ? `${row.recurring - before.recurring >= 0 ? "+" : ""}${yen(row.recurring - before.recurring)}` : "—";
  function branch(id: string, seen = new Set<string>()): React.ReactNode {
    if (seen.has(id)) return null;
    const node = nodes.find(n => n.id === id); if (!node) return null;
    const potential = input.leaders.find(l => l.id === node.leaderId)?.potentialDownlineIds;
    const children = nodes.filter(n => n.parentId === id);
    const sourceId = dragging;
    const reason = sourceId ? placementError(nodes, sourceId, id, input.rootId) : null;
    const changed = baseline && placementNodes(baseline.base, baseline.input).find(n => n.id === id)?.parentId !== node.parentId;
    return <li key={id}>
      <div className={`canvas-node ${node.planned ? "planned" : ""} ${selected === id ? "selected" : ""} ${hover === id ? reason ? "invalid" : "drop" : ""}`}
        data-node-id={id} draggable={!p.busy && !viewBefore && id !== input.rootId}
        onDragStart={e => { e.stopPropagation(); dragSource.current = id; setDragging(id); e.dataTransfer.setData("application/x-navigator-node", id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { dragSource.current = null; setDragging(null); setHover(null); }}
        onDragOver={e => { const from = dragSource.current; if (!from) return; e.preventDefault(); e.stopPropagation(); setHover(id); e.dataTransfer.dropEffect = placementError(nodes, from, id, input.rootId) ? "none" : "move"; }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); const from = dragSource.current; if (from) move(from, id); dragSource.current = null; setDragging(null); setHover(null); }}>
        {children.length > 0 && <button className="canvas-fold" aria-label={`${node.name}の配下を${folded.has(id) ? "展開" : "収納"}`} aria-expanded={!folded.has(id)} onClick={() => setFolded(old => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; })}>{folded.has(id) ? "＋" : "−"}</button>}
        {id !== input.rootId && <button className="canvas-drag-handle" aria-label={`${node.name}をドラッグして移動`} disabled={p.busy || viewBefore}
          onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); pointerDrag.current = { id, x: e.clientX, y: e.clientY, moved: false }; }}
          onPointerMove={e => { const d = pointerDrag.current; if (!d || d.id !== id) return; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && !d.moved) return; d.moved = true; setDragging(id); const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId; setHover(target ?? null); }}
          onPointerUp={e => { const d = pointerDrag.current; pointerDrag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId; if (d?.moved && target && target !== id) move(id, target); else { setSelected(id); setMoveTarget(""); } setDragging(null); setHover(null); }}
          onPointerCancel={() => { pointerDrag.current = null; setDragging(null); setHover(null); }}
          onClick={() => { setSelected(id); setMoveTarget(""); }}>⠿</button>}
        <button className="canvas-person" aria-pressed={selected === id} onClick={() => { setSelected(id); setMoveTarget(""); setError(""); }}><strong>{node.name}</strong><span>{id === input.rootId ? "自分 · メイン" : node.sub ? `${nodes.find(n => n.id === node.ownerId)?.name ?? "所有者"}のサブ` : id === input.partnerId ? "パートナー" : node.planned ? "追加予定チーム" : "登録済み"}{changed ? " · 配置変更" : ""}</span>{potential != null && <small>配下の想定 {potential.toLocaleString()} ID</small>}</button>
        {sourceId && hover === id && <small className="canvas-drop-reason">{reason ?? "ここへチームごと移動"}</small>}
      </div>
      {!folded.has(id) && children.length > 0 && <ul>{children.map(child => branch(child.id, new Set([...seen, id])))}</ul>}
    </li>;
  }
  return <div className="strategy-canvas">
    <header className="canvas-heading"><div><p className="canvas-eyebrow">配置と収入を、一緒に考える</p><h1>{input.targetTitle}への組織をつくる</h1><p>{input.name} <span className="canvas-badge">試算のみ</span></p><NavLink className="canvas-guide-link" to="/guide" target="_blank" rel="noopener noreferrer" aria-label="画像でわかる使い方（別タブで開く）">画像でわかる使い方 ↗</NavLink></div><div className="canvas-tools"><button onClick={p.saved}>保存したプラン</button><button onClick={p.settings}>前提・詳細設定</button><button className="canvas-primary" disabled={p.busy || p.dirty || !p.result || p.saving || viewBefore} onClick={p.save}>{p.saving ? "保存中…" : "別案として保存"}</button></div></header>
    <div className="canvas-context"><span>出発点 {p.base.period}度</span><span>集計：自分{input.partnerId ? "＋パートナー" : ""}と所有サブ</span><label>成長前提<select aria-label="成長前提" value={p.band} onChange={e => p.setBand(e.target.value as Band)}>{BANDS.map(b => <option key={b} value={b}>{bandNames[b]}</option>)}</select></label></div>
    <div className="canvas-toolbar"><div><button className="canvas-primary" disabled={p.busy || viewBefore} onClick={() => setShowAdd(v => !v)}>＋ 人・チームを追加</button><button disabled={!history.length || p.busy || viewBefore} onClick={() => { const last = history.at(-1)!; setHistory(h => h.slice(0, -1)); setError(""); p.change(last); p.compute(last); }}>元に戻す</button></div><div><button disabled={!baseline || p.busy} aria-pressed={viewBefore} onClick={() => setViewBefore(v => !v)}>{viewBefore ? "変更後に戻る" : "変更前を見る"}</button>{p.busy ? <button onClick={p.cancel}>計算を中止</button> : <button onClick={() => p.compute()}>再計算</button>}</div></div>
    {showAdd && <section className="canvas-add" aria-label="追加するチームの種類">{[["single", "1人"], ["twenty", "20人一括"], ["team", "リーダー＋10人"], ["one", "1人が1人"], ["three", "3人が3人"]].map(([kind, label]) => <button key={kind} disabled={p.busy || input.leaders.length >= 12} onClick={() => { setHistory(h => [...h.slice(-19), structuredClone(p.input)]); p.addTeam(kind!); setShowAdd(false); }}>{label}</button>)}</section>}
    {error && <p role="alert" className="canvas-error">{error}</p>}
    <div className="canvas-workspace">
      <section className="canvas-board"><div className="canvas-section-heading"><h2>{viewBefore ? "変更前の配置" : "操作する組織"}</h2><span>配下を含めて移動</span></div><p className="canvas-hint">チームを配置先へドラッグ。タップで選び「配置先を変更」でも操作できます。</p><ul className="canvas-tree">{branch(input.rootId)}</ul>
        {active && <section className="canvas-inspector" aria-label="選択したメンバー"><div className="canvas-section-heading"><h3>{active.name}</h3><button onClick={() => setSelected(null)} aria-label="選択を閉じる">×</button></div><p>紹介者：{nodes.find(n => n.id === active.introducerId)?.name ?? "なし"}（配置を動かしても変わりません）</p>
          {active.id !== input.rootId && <div className="canvas-move"><label>配置先を変更<select aria-label="移動先" value={moveTarget} disabled={p.busy || viewBefore} onChange={e => setMoveTarget(e.target.value)}><option value="">移動先を選ぶ</option>{nodes.map(n => { const reason = placementError(nodes, active.id, n.id, input.rootId); return <option key={n.id} value={n.id} disabled={!!reason}>{n.name}{reason ? ` · ${reason}` : ""}</option>; })}</select></label><button disabled={!moveTarget || p.busy || viewBefore} onClick={() => move(active.id, moveTarget)}>ここへ移動</button></div>}
          {leader && <div className="canvas-fields"><label>チーム名<input key={`${leader.id}-${leader.name}`} defaultValue={leader.name} maxLength={80} disabled={p.busy || viewBefore} onBlur={e => { const name = e.target.value.trim() || "試算"; if (name !== leader.name) updateLeader({ name }); }}/></label><label>一緒に加入する人数<NumberField key={`team-${leader.id}`} value={leader.initialTeam} min={0} max={2000} disabled={p.busy || viewBefore || !!leader.existingMemberId} change={n => updateLeader({ initialTeam: n })}/></label><label>加入・成長開始（月後）<NumberField key={`start-${leader.id}`} value={leader.startMonth} min={1} max={12000} disabled={p.busy || viewBefore} change={n => updateLeader({ startMonth: n })}/></label></div>}
          {leader && <TeamPotentialField key={leader.id} value={leader.potentialDownlineIds} minimum={leader.initialTeam} disabled={p.busy || viewBefore} change={potentialDownlineIds => updateLeader({ potentialDownlineIds })}/>}
          {!leader && !active.sub && !active.planned && <><button disabled={p.busy || viewBefore || input.leaders.length >= 12} onClick={() => commit({ ...p.input, leaders: [...p.input.leaders, {
            id: `growth-${active.id}`, name: active.name, existingMemberId: active.id, introducerId: active.introducerId ?? input.rootId, placementId: active.id,
            startMonth: 1, initialTeam: 0, leaderCourse: p.base.members.find(m => m.id === active.id)?.course ?? "G", targetWeight: 1, licenseAfterMonths: null,
            phases: structuredClone(input.leaders.find(l => l.existingMemberId === input.rootId)?.phases ?? [defaultPhase()])
          }] })}>この人の成長・ポテンシャルを設定</button><p className="canvas-hint">個別の成長前提として設定します（最大12チーム）。</p></>}
          <p className="canvas-hint">既存IDの移動も仮定上の比較です。公式の配置変更は行いません。</p>
        </section>}
      </section>
      <aside className="canvas-outcome" aria-label="目標到達時の結果" aria-busy={stale}>
        <div className="canvas-section-heading"><h2>{endpoint ? `${input.targetTitle}到達時` : outcome ? `${time(outcome.month)}時点の結果` : "計算結果"}</h2><span>{viewBefore ? "変更前" : "変更後"} · {bandNames[p.band]}</span></div>
        <p>世帯の継続月額</p><div className="canvas-income" data-testid="endpoint-income">{stale ? p.busy ? "再計算中…" : "再計算待ち" : outcome ? yen(outcome.recurring) : "未算出"}</div>
        {baseline && !stale && !viewBefore && <p className="canvas-delta">{endpoint ? "到達時の月額の差" : "同じ経過時点の月額の差"} {delta(outcome, beforeOutcome)}{!sameInputs && <small>配置以外の前提・ルール変更も含みます</small>}</p>}
        <div className="canvas-outcome-stats"><div><span>{input.targetTitle}到達まで</span><strong>{stale ? "—" : time(variant?.titleMonth)}</strong></div><div><span>{endpoint ? "到達時の組織人数" : "この時点の組織人数"}</span><strong>{outcome ? `${outcome.count.toLocaleString()} ID` : "—"}</strong></div><div><span>購入費控除後の参考月額</span><strong>{outcome ? yen(outcome.recurringCashflow) : "—"}</strong></div></div>
        {!stale && !endpoint && <p className="canvas-hint">{input.goalBasis !== "title" ? "旧形式の保存結果です。TRD基準への切替は前提・詳細設定から行えます。" : `${input.horizonMonths / 12}年の計算範囲では${input.targetTitle}に未到達です。途中の月額は下の比較で確認できます。`}</p>}
        {outcome && <Income row={outcome} title="各ID・ボーナス内訳"/>}
        {!stale && variant && <details className="canvas-final-details"><summary>{endpoint ? "到達時の組織を見る" : "計算終了時の組織を見る"}</summary><p className="canvas-hint">{endpoint ? "主要IDとチームを集約表示" : `${time(variant.months.at(-1)?.month)}時点。`}</p><OrganizationResultTree nodes={variant.finalOrganization}/></details>}
        {!stale && !endpoint && variant && <details><summary>{input.targetTitle}までの不足条件</summary><ul>{variant.months.at(-1)?.missing.map(s => <li key={s}>{s}</li>)}</ul><button disabled={p.busy || viewBefore || input.horizonMonths >= 12000} onClick={() => commit({ ...p.input, horizonMonths: Math.min(12000, p.input.horizonMonths + 120) })}>さらに10年先まで計算</button></details>}
        {!stale && endpoint && <p className="canvas-hint">到達後12か月の平均参考月額：{variant?.postCompletionAverage == null ? "未算出" : yen(variant.postCompletionAverage)}。目標タイトル未維持：{variant?.maintenanceFailures}か月。</p>}
        {!stale && !!variant?.warnings.length && <details><summary>計算の前提・補足</summary><ul>{variant.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      </aside>
    </div>
    <section className="canvas-comparison" aria-label="案Aと案Bの比較">
      <div className="canvas-section-heading"><h2>何を揃えて比べる？</h2><button disabled={!p.result || p.dirty || p.busy || viewBefore} onClick={() => { setBaseline({ input: structuredClone(p.input), result: p.result!, base: p.base }); setViewBefore(false); }}>現在の案を比較基準Aに固定</button></div>
      <div className="canvas-comparison-controls"><div className="canvas-basis">{([["title", "同じタイトル"], ["members", "同じくらいの人数"], ["month", "同じ経過時間"]] as const).map(([key, label]) => <button key={key} aria-pressed={basis === key} onClick={() => setBasis(key)}>{label}</button>)}</div>
        {basis === "members" && <label>人数の目安<select value={comparisonCount} onChange={e => setComparisonCount(Number(e.target.value))}>{CHECKPOINTS.map(n => <option key={n} value={n}>{n.toLocaleString()} ID前後</option>)}</select></label>}
        {basis === "month" && <label>開始からの月数<input type="number" min="0" max="12000" value={comparisonMonth} onChange={e => setComparisonMonth(Number(e.target.value))}/></label>}
      </div>
      <p className="canvas-hint">{basis === "title" ? `${input.targetTitle}になったとき、月額と到達までの期間はどう違う？` : basis === "members" ? `${comparisonCount.toLocaleString()} IDを目安に、その規模になるまでの期間と月額を比べます。` : "同じ時間をかけたとき、人数・タイトル・月額はどう違う？"}</p>
      {!baseline && <p className="canvas-hint">配置を動かすと移動前が案Aになります。保存したプランを比較基準にすることもできます。</p>}
      <div className="canvas-compare-grid">{[{ name: "案A · 比較基準", row: comparisonA, request: baseline?.input }, { name: viewBefore ? "案Aを表示中" : "案B · 編集中", row: comparisonB, request: input }].map(({ name, row, request }) => <section key={name}><h3>{name}</h3><small>{request?.name ?? "未設定"}</small><dl><div><dt>継続月額</dt><dd>{row ? yen(row.recurring) : "—"}</dd></div><div><dt>経過時間</dt><dd>{row ? time(row.month) : "—"}</dd></div><div><dt>組織ID数</dt><dd>{row ? `${row.count.toLocaleString()} ID` : "—"}</dd></div><div><dt>目標IDのタイトル</dt><dd>{row ? row.targetTitle === "NONE" ? "未取得" : row.targetTitle : "—"}</dd></div><div><dt>購入費控除後の参考月額</dt><dd>{row ? yen(row.recurringCashflow) : "—"}</dd></div><div><dt>累計参考収支（一時報酬を含む）</dt><dd>{row ? yen(row.cumulative) : "—"}</dd></div></dl>{row && <Income row={row} title="この時点の内訳"/>}{!row && <p className="canvas-hint">{name.startsWith("案B") && stale ? p.busy ? "再計算中" : "前提変更あり・再計算待ち" : request ? "未到達または計算範囲外" : "基準案を選んでください"}</p>}</section>)}</div>
      {baseline && !viewBefore && <p className="canvas-hint">{sameInputs ? "配置以外の入力と出発点は同じです。" : "成長・購入・資格などの前提、または出発点も異なります。配置だけの差ではありません。"}</p>}
      {!comparableTitle && <p role="status">目標タイトルまたは対象IDが異なるため、同じタイトルの差額としては比較できません。</p>}
      {basis === "members" && comparisonA && comparisonB && <small>比較時の人数：案A {comparisonA.count.toLocaleString()} ID ／ 案B {comparisonB.count.toLocaleString()} ID</small>}
      {!stale && !viewBefore && comparableTitle && comparisonA && comparisonB && <><p className="canvas-delta">継続月額の差 {delta(comparisonB, comparisonA)} ／ 経過時間の差 {comparisonB.month - comparisonA.month}か月</p><details><summary>各IDの差額と理由を確認</summary><div className="canvas-id-diff">{incomeDifferences(comparisonA, comparisonB).map(d => <div key={d.id}><h3>{d.name}</h3><p>{d.beforeTitle} → {d.afterTitle}</p><span>ライン {yen(d.line)}</span><span>ディレクター {yen(d.director)}</span><span>タイトル {yen(d.title)}</span><strong>継続合計 {yen(d.recurring)}</strong></div>)}</div></details></>}
    </section>
    {baseline && !stale && !viewBefore && endpoint && beforeEndpoint && <section className="canvas-reasons"><h2>なぜ金額が変わった？</h2><p>{sameInputs ? "同じ成長前提・購入条件で、配置の影響を比較しています。" : "前提も変更されています。配置だけの差ではありません。"}</p><div className="canvas-id-diff">{endpoint.ids.map(id => { const old = beforeEndpoint.ids.find(n => n.id === id.id); return <div key={id.id}><h3>{id.name}</h3><p>{old?.title ?? "未登録"} → {id.title}</p><span>ライン {yen(id.line - (old?.line ?? 0))}</span><span>ディレクター {yen(id.director - (old?.director ?? 0))}</span><span>タイトル {yen(id.titleBonus - (old?.titleBonus ?? 0))}</span></div>; })}</div><p className="canvas-hint">それぞれの到達時点の比較です。到達人数・営業月が異なる場合があります。</p></section>}
    <section className="canvas-roadmap"><div className="canvas-section-heading"><h2>途中の成長を見る</h2><span>目標は{input.targetTitle}。人数は途中の目印です。</span></div><div className="canvas-milestones"><button aria-pressed={checkpoint === null} onClick={() => setCheckpoint(null)}>{input.targetTitle}到達</button><button aria-pressed={checkpoint === 0} onClick={() => setCheckpoint(0)}>現在</button>{CHECKPOINTS.map(n => <button key={n} aria-pressed={checkpoint === n} onClick={() => setCheckpoint(n)}>{n.toLocaleString()} ID</button>)}</div>
      {checkpoint !== null && <div aria-live="polite">{stale ? <p>途中経過も再計算しています…</p> : stageRow ? <><h3>{checkpoint === 0 ? "出発点" : `${checkpoint.toLocaleString()} ID通過時`} · {time(stageRow.month)} ／ {stageRow.period}度</h3><p>実数 {stageRow.count.toLocaleString()} ID · 継続月額 {yen(stageRow.recurring)}{baselineStage && !viewBefore ? ` ／ 変更前との差 ${delta(stageRow, baselineStage)}` : ""}</p><Income row={stageRow}/>{stageNodes && <div className="canvas-stage-lines">{stageNodes.map(n => <p key={n.id}>{n.name}：{n.title === "NONE" ? "未取得" : n.title} ／ 配下 {n.active} ID</p>)}</div>}</> : <p>この人数には計算期間内で到達していません。終了時点からあと {chosenCheckpoint?.remaining.toLocaleString() ?? "—"} ID。目標タイトルの不足は右の結果で確認できます。</p>}</div>}
    </section>
    <footer className="canvas-footnote"><span>非公式・条件付き試算。一時ボーナスは継続月額に含めません。</span><NavLink to="/guide" target="_blank" rel="noopener noreferrer" aria-label="画像でわかる使い方（別タブで開く）">画像でわかる使い方 ↗</NavLink><NavLink to="/reference/titles">タイトル条件表</NavLink></footer>
  </div>;
}
