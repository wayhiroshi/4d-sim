import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { BANDS, CHECKPOINTS, defaultPhase, type Band, type LeaderGrowthProfile, type StrategySimulationRequest, type StrategySimulationResult } from "./shared/strategy";
import type { OrganizationSnapshot } from "./shared/types";
import { movePlacement, placementError, placementNodes } from "./domain/strategy-placement";
import { comparisonPoint, sameGrowthAssumptions, type ComparisonBasis } from "./domain/strategy-comparison";
import { initialFrameMonth, strategyFrame } from "./domain/strategy-frame";
import { Income } from "./StrategyStudio";
import TeamPotentialField from "./TeamPotentialField";
import StrategyAlternatives from "./StrategyAlternatives";
import StrategyPrerequisites from "./StrategyPrerequisites";
import "./strategy-canvas.css";

const yen = (v: number) => `${Math.round(v).toLocaleString("ja-JP")}円`;
const deltaYen = (v: number) => `${v > 0 ? "+" : ""}${yen(v)}`;
const time = (m: number | null | undefined) => m == null ? "期間内に未到達" : m === 0 ? "現在" : `${m >= 12 ? `${Math.floor(m / 12)}年` : ""}${m % 12 ? `${m % 12}か月` : ""}`;
const bandNames = { conservative: "保守", standard: "標準", challenge: "挑戦" };
function NumberField({ value, min, max, disabled, change }: { value: number; min: number; max: number; disabled: boolean; change: (n: number) => void }) {
  return <input key={value} type="number" defaultValue={value} min={min} max={max} disabled={disabled} onBlur={e => { const n = Number(e.target.value); if (!e.target.value || !Number.isInteger(n) || n < min || n > max) { e.target.value = String(value); return; } if (n !== value) change(n); }}/>;
}
function Panel({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={dialog} className="canvas-dialog" aria-label={title} onCancel={close}><div className="canvas-section-heading"><h2>{title}</h2><button onClick={close} aria-label={`${title}を閉じる`}>閉じる ×</button></div>{children}</dialog>;
}
export type Comparison = { input: StrategySimulationRequest; result: StrategySimulationResult; base: OrganizationSnapshot };
interface Props {
  base: OrganizationSnapshot; input: StrategySimulationRequest; result: StrategySimulationResult | null; busy: boolean; dirty: boolean;
  band: Band; setBand: (band: Band) => void;
  change: (input: StrategySimulationRequest) => void; compute: (input?: StrategySimulationRequest) => void;
  settings: () => void; qualifications: () => void; saved: () => void; save: () => void; saving: boolean; cancel: () => void;
  addTeam: (kind: string) => void; reference: Comparison | null; setReference: (reference: Comparison | null) => void;
}
export default function StrategyCanvas(p: Props) {
  const [selected, setSelected] = useState<string | null>(null), [dragging, setDragging] = useState<string | null>(null), [hover, setHover] = useState<string | null>(null);
  const dragSource = useRef<string | null>(null), pointerDrag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set()), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [history, setHistory] = useState<StrategySimulationRequest[]>([]), [future, setFuture] = useState<StrategySimulationRequest[]>([]);
  const [cursor, setCursor] = useState<number | null>(null), [moveTarget, setMoveTarget] = useState("");
  const [panel, setPanel] = useState<"add" | "details" | "options" | "compare" | "search" | null>(null);
  const [basis, setBasis] = useState<ComparisonBasis>("title"), [comparisonCount, setComparisonCount] = useState(500);
  const started = useRef(false), source = useRef(p.base);
  useEffect(() => { if (!started.current) { started.current = true; if (!p.result) p.compute(); } });
  useEffect(() => { if (source.current !== p.base) { source.current = p.base; setHistory([]); setFuture([]); setCursor(null); setSelected(null); setNotice(""); } }, [p.base]);
  const input = p.input, variant = p.result?.variants[0]?.bands[p.band], previous = p.reference?.result.variants[0]?.bands[p.band];
  const stale = p.busy || p.dirty, lastMonth = variant?.months.at(-1)?.month ?? 0;
  const month = Math.min(cursor ?? initialFrameMonth(variant), lastMonth), frame = strategyFrame(variant, month);
  const outcome = stale ? null : frame.row, before = strategyFrame(previous, month).row;
  const nodes = placementNodes(p.base, input), active = nodes.find(n => n.id === selected), leader = input.leaders.find(l => l.id === active?.leaderId);
  const metrics = new Map((!stale ? frame.organization ?? [] : []).map(n => [n.id, n]));
  // Future entrants remain editable ghosts, never counted as already enrolled.
  const treeNodes = !stale && frame.organization ? [...frame.organization.map(n => ({ id: n.id, name: n.name, parentId: n.parentId })), ...nodes.filter(n => n.planned && !metrics.has(n.id))] : nodes;
  const sameInputs = !!p.reference && p.reference.result.engineVersion === p.result?.engineVersion && p.reference.result.planVersion === p.result?.planVersion && JSON.stringify(p.reference.base) === JSON.stringify(p.base) && sameGrowthAssumptions(p.reference.input, input);
  const arrivedDelta = variant?.titleMonth != null && previous?.titleMonth != null ? variant.titleMonth - previous.titleMonth : null;
  const arrivalChange = !previous ? null : arrivedDelta != null ? arrivedDelta === 0 ? "到達時期は同じ" : `${time(Math.abs(arrivedDelta))}${arrivedDelta < 0 ? "早く" : "遅く"}` : variant?.titleMonth != null ? "期間内に到達する案へ" : previous.titleMonth != null ? "期間内の到達がなくなりました" : "変更前も期間内に未到達";
  function remember() { if (p.result && !stale) p.setReference({ input: structuredClone(input), result: p.result, base: p.base }); setCursor(month); setHistory(h => [...h.slice(-19), structuredClone(input)]); setFuture([]); setError(""); }
  function commit(next: StrategySimulationRequest) { remember(); p.change(next); p.compute(next); }
  function move(id: string, parent: string) {
    try { const next = movePlacement(p.base, input, id, parent); commit(next); setNotice(`${nodes.find(n => n.id === id)?.name}を${nodes.find(n => n.id === parent)?.name}の下へ移動`); setMoveTarget(""); setSelected(null); }
    catch (e) { setError((e as Error).message); }
    setDragging(null); setHover(null);
  }
  function updateLeader(patch: Partial<LeaderGrowthProfile>) { if (leader) commit({ ...input, leaders: input.leaders.map(l => l.id === leader.id ? { ...l, ...patch } : l) }); }
  function restore(direction: "undo" | "redo") {
    const next = (direction === "undo" ? history : future).at(-1); if (!next) return;
    if (p.result && !stale) p.setReference({ input: structuredClone(input), result: p.result, base: p.base });
    if (direction === "undo") { setFuture(f => [...f, structuredClone(input)]); setHistory(h => h.slice(0, -1)); } else { setHistory(h => [...h, structuredClone(input)]); setFuture(f => f.slice(0, -1)); }
    setError(""); setNotice(direction === "undo" ? "一つ前の配置に戻しました" : "変更をやり直しました"); p.change(next); p.compute(next);
  }
  function select(id: string) { setSelected(id); setMoveTarget(""); setError(""); }
  function branch(id: string, seen = new Set<string>()): ReactNode {
    if (seen.has(id)) return null;
    const node = treeNodes.find(n => n.id === id); if (!node) return null;
    const editable = nodes.find(n => n.id === id), metric = metrics.get(id), children = treeNodes.filter(n => n.parentId === id);
    const pending = !!editable?.planned && !metric && !stale;
    const remaining = metric ? Math.max(0, metric.count - children.reduce((sum, child) => { const m = metrics.get(child.id); return sum + (m ? m.count + (m.enrolled === false ? 0 : 1) : 0); }, 0)) : 0;
    const reason = dragging ? placementError(nodes, dragging, id, input.rootId) : null;
    const canMove = !!editable && id !== input.rootId && metric?.enrolled !== false, hasChildren = children.length > 0 || remaining > 0;
    const role = id === input.rootId ? "自分" : id === input.partnerId ? "パートナー" : editable?.sub ? `${nodes.find(n => n.id === editable.ownerId)?.name ?? "所有者"}のサブ` : editable?.planned ? "仮チーム" : "メンバー";
    return <li key={id}><div className={`canvas-node ${pending ? "pending" : ""} ${selected === id ? "selected" : ""} ${hover === id ? reason ? "invalid" : "drop" : ""}`}
      data-node-id={editable ? id : undefined} draggable={canMove}
      onDragStart={e => { if (!canMove) return; e.stopPropagation(); dragSource.current = id; setDragging(id); e.dataTransfer.setData("application/x-navigator-node", id); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={() => { dragSource.current = null; setDragging(null); setHover(null); }}
      onDragOver={e => { if (!dragSource.current || !editable) return; e.preventDefault(); e.stopPropagation(); setHover(id); e.dataTransfer.dropEffect = placementError(nodes, dragSource.current, id, input.rootId) ? "none" : "move"; }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragSource.current && editable) move(dragSource.current, id); dragSource.current = null; }}>
      {hasChildren ? <button className="canvas-fold" aria-label={`${node.name}の配下を${folded.has(id) ? "展開" : "収納"}`} aria-expanded={!folded.has(id)} onClick={() => setFolded(old => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; })}>{folded.has(id) ? "＋" : "−"}</button> : <span className="canvas-fold-space"/>}
      <button className="canvas-person" disabled={!editable} aria-pressed={selected === id} onClick={() => select(id)}><span className="canvas-node-role">{role}{pending ? " · まだ加入前" : ""}</span><strong>{node.name} <span className="canvas-node-count">{metric ? `(${metric.count.toLocaleString()})` : pending ? "(未加入)" : ""}</span></strong><span>{metric ? `${metric.enrolled === false ? "退会済 · " : ""}${metric.title === "NONE" ? "タイトル条件未達" : metric.title}` : pending ? "この時点の人数・報酬には含めません" : "配置プラン"}</span></button>
      {canMove && <button className="canvas-drag-handle" aria-label={`${node.name}をドラッグして移動`}
        onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); pointerDrag.current = { id, x: e.clientX, y: e.clientY, moved: false }; }}
        onPointerMove={e => { const d = pointerDrag.current; if (!d || d.id !== id || (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5)) return; d.moved = true; setDragging(id); setHover(document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null); }}
        onPointerUp={e => { const d = pointerDrag.current; pointerDrag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId; if (d?.moved && target && target !== id) move(id, target); else select(id); setDragging(null); setHover(null); }}
        onPointerCancel={() => { pointerDrag.current = null; setDragging(null); setHover(null); }} onClick={() => select(id)}>⠿</button>}
      {dragging && hover === id && <small className="canvas-drop-reason">{reason ?? "ここへチームごと移動"}</small>}
    </div>{hasChildren && !folded.has(id) && <ul>{children.map(child => branch(child.id, new Set([...seen, id])))}{remaining > 0 && <li className="canvas-aggregate">この下のメンバー <strong>({remaining.toLocaleString()})</strong></li>}</ul>}</li>;
  }
  const comparisonValue = basis === "month" ? month : comparisonCount, comparisonA = p.reference ? comparisonPoint(previous, p.reference.input, basis, comparisonValue) : null, comparisonB = stale ? null : comparisonPoint(variant, input, basis, comparisonValue);
  return <div className="strategy-canvas">
    <header className="canvas-heading"><div><h1>配置を動かして、未来を比べる</h1><p>{input.name} <span className="canvas-badge">試算</span></p></div><div className="canvas-tools"><button onClick={() => setPanel("options")}>その他</button><button className="canvas-primary" disabled={stale || !p.result || p.saving} onClick={p.save}>{p.saving ? "保存中…" : "この案を保存"}</button></div></header>
    <section className="canvas-dashboard" aria-label="表示時点の試算結果" aria-busy={stale}>
      <div className="canvas-scoreboard"><div className="canvas-main-score"><span>世帯の継続月額</span><strong data-testid="frame-income">{outcome ? yen(outcome.recurring) : p.busy ? "計算中…" : "未計算"}</strong><span className="canvas-score-delta">{outcome && before ? `変更前より ${deltaYen(outcome.recurring - before.recurring)}` : "一時ボーナスを除いた金額"}</span></div><div className="canvas-arrival"><span>{input.targetTitle}になるまで</span><strong>{stale ? "計算中…" : time(variant?.titleMonth)}</strong><span className="canvas-score-delta">{!stale && arrivalChange ? arrivalChange : `対象：${nodes.find(n => n.id === input.targetId)?.name ?? "目標ID"}`}</span></div><button className="canvas-detail-button" disabled={!outcome} onClick={() => setPanel("details")}>金額の内訳 ↗</button></div>
      <div className="canvas-timebar"><div className="canvas-time-heading"><strong data-testid="frame-time">{month === 0 ? "現在の組織" : `${time(month)}後の組織`}</strong><span>{outcome ? `稼働 ${outcome.count.toLocaleString()} / 在籍 ${outcome.enrolled.toLocaleString()} ID · ${outcome.period}度` : "人数・タイトルも更新します"}</span></div><div className="canvas-slider"><button disabled={!variant || stale} onClick={() => setCursor(0)}>現在</button><input aria-label="表示する経過月" aria-valuetext={time(month)} type="range" min="0" max={Math.max(1, lastMonth)} step="1" value={month} disabled={!variant || stale} onChange={e => setCursor(Number(e.target.value))}/><button disabled={!variant || stale} onClick={() => setCursor(initialFrameMonth(variant))}>{variant?.titleMonth != null ? `${input.targetTitle}到達` : lastMonth ? `${time(lastMonth)}後` : "計算後"}</button></div></div>
    </section>
    <StrategyPrerequisites base={p.base} input={input} busy={p.busy} apply={commit} settings={p.qualifications}/>
    <div className="canvas-toolbar"><div><button className="canvas-primary" onClick={() => setPanel("add")} disabled={stale}>＋ 人・チーム</button><button disabled={!history.length} onClick={() => restore("undo")}>↶ 元に戻す</button><button disabled={!future.length} onClick={() => restore("redo")} aria-label="やり直す">↷</button></div><span className="canvas-instruction">人をつかんで、配置先へ。タップでも移動できます。</span></div>
    {error && <p role="alert" className="canvas-error">{error}</p>}<p className="canvas-notice" role="status">{p.busy ? `${notice ? `${notice}。` : ""}結果を再計算しています…` : notice || "配置を変えると、上の月額と到達時期の差が変わります。"}{p.busy && <button onClick={p.cancel}>中止</button>}{!p.busy && p.dirty && <button onClick={() => p.compute()}>再計算</button>}</p>
    <div className={`canvas-workspace ${active ? "has-inspector" : ""}`}><section className="canvas-board" aria-label="表示時点の組織図" data-month={month}><div className="canvas-section-heading"><h2>{time(month)}{month > 0 ? "後" : ""}の配置</h2><small>(数字) ＝ 配下の在籍ID数</small></div>{!stale && !frame.organization && <p className="canvas-hint">古い保存結果のため配置プランのみ表示しています。<button onClick={() => p.compute()}>月別の組織図を計算</button></p>}<ul className="canvas-tree">{branch(input.rootId)}</ul><p className="canvas-board-note">実際の登録は変わりません。移動は試算の出発点の配置へ反映します。</p></section>
      {active && <aside className="canvas-inspector" aria-label="選択したメンバー"><div className="canvas-section-heading"><h2>{active.name}</h2><button onClick={() => setSelected(null)} aria-label="選択を閉じる">×</button></div>{active.id !== input.rootId && <div className="canvas-move"><label>誰の下に置きますか？<select aria-label="移動先" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}><option value="">配置先を選ぶ</option>{nodes.map(n => { const reason = placementError(nodes, active.id, n.id, input.rootId); return <option key={n.id} value={n.id} disabled={!!reason}>{n.name}{reason ? ` · ${reason}` : ""}</option>; })}</select></label><button className="canvas-primary" disabled={!moveTarget} onClick={() => move(active.id, moveTarget)}>ここへ移動して試算</button></div>}
        {leader && <><TeamPotentialField key={leader.id} value={leader.potentialDownlineIds} minimum={leader.initialTeam} disabled={stale} change={potentialDownlineIds => updateLeader({ potentialDownlineIds })}/><details><summary>名前・加入時期を編集</summary><div className="canvas-fields"><label>チーム名<input key={`${leader.id}-${leader.name}`} defaultValue={leader.name} maxLength={80} disabled={stale} onBlur={e => { const name = e.target.value.trim() || "試算"; if (name !== leader.name) updateLeader({ name }); }}/></label><label>一緒に加入する人数<NumberField value={leader.initialTeam} min={0} max={2000} disabled={stale || !!leader.existingMemberId} change={n => updateLeader({ initialTeam: n })}/></label><label>加入・成長開始（月後）<NumberField value={leader.startMonth} min={1} max={12000} disabled={stale} change={n => updateLeader({ startMonth: n })}/></label></div></details></>}
        {!leader && !active.sub && !active.planned && <button disabled={stale || input.leaders.length >= 12} onClick={() => commit({ ...input, leaders: [...input.leaders, { id: `growth-${active.id}`, name: active.name, existingMemberId: active.id, introducerId: active.introducerId ?? input.rootId, placementId: active.id, startMonth: 1, initialTeam: 0, leaderCourse: p.base.members.find(m => m.id === active.id)?.course ?? "G", targetWeight: 1, licenseAfterMonths: null, phases: structuredClone(input.leaders.find(l => l.existingMemberId === input.rootId)?.phases ?? [defaultPhase()]) }] })}>この人のポテンシャルを設定</button>}
        <button disabled={stale} onClick={() => setPanel("search")}>この配置・育成順の候補を比較</button><small>紹介者：{nodes.find(n => n.id === active.introducerId)?.name ?? "なし"}</small>
      </aside>}
    </div>
    <footer className="canvas-footnote"><span>自分{input.partnerId ? "・パートナー" : ""}と所有サブの合計 · {bandNames[p.band]}の前提</span><NavLink to="/guide" target="_blank" rel="noopener noreferrer">使い方 ↗</NavLink><span>非公式の条件付き試算</span></footer>
    {panel === "add" && <Panel title="追加するチーム" close={() => setPanel(null)}><div className="canvas-add">{[["single", "1人"], ["twenty", "20人一括"], ["team", "リーダー＋10人"], ["one", "1人が1人を紹介"], ["three", "3人が3人を紹介"]].map(([kind, name]) => <button key={kind} disabled={stale || input.leaders.length >= 12} onClick={() => { remember(); p.addTeam(kind!); setPanel(null); }}>{name}</button>)}</div>{input.leaders.length >= 12 && <p>成長チームは12件まで設定できます。</p>}</Panel>}
    {panel === "details" && outcome && <Panel title={`${time(month)}${month ? "後" : ""}の金額内訳`} close={() => setPanel(null)}><dl className="canvas-money">{[["継続月額",outcome.recurring],["うちラインボーナス",outcome.line],["一時ボーナス",outcome.gross-outcome.recurring],["総ボーナス",outcome.gross],["継続分の概算手取",outcome.recurringNet],["所有IDの購入費",outcome.costs],["購入費控除後の参考月額",outcome.recurringCashflow]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{yen(Number(value))}</dd></div>)}</dl><Income row={outcome} title="ID別・5種類のボーナス（総額）"/><p className="canvas-hint">公式明細ではありません。一時ボーナスは継続月額に含めていません。</p></Panel>}
    {panel === "options" && <Panel title="その他の操作" close={() => setPanel(null)}><div className="canvas-option-list"><button onClick={p.saved}>保存したプランを開く</button><button onClick={() => setPanel("compare")}>変更前と詳しく比べる</button><button onClick={() => setPanel("search")}>配置・育成順の候補を探す</button><button onClick={p.settings}>成長前提・サブ・詳細設定</button></div><label>表示する成長前提<select value={p.band} onChange={e => p.setBand(e.target.value as Band)}>{BANDS.map(b => <option key={b} value={b}>{bandNames[b]}</option>)}</select></label><details><summary>人数の節目へ移動</summary><div className="canvas-milestones">{variant?.checkpoints.map(c => <button key={c.memberCount} disabled={stale || !c.reached} onClick={() => { setCursor(c.reachedMonth); setPanel(null); }}>{c.memberCount.toLocaleString()} ID{!c.reached ? "（未到達）" : ""}</button>)}</div></details>{!stale && variant && <details open={variant.titleMonth === null}><summary>{input.targetTitle}までの不足条件</summary><ul>{(outcome?.missing ?? []).map(s => <li key={s}>{s}</li>)}</ul><button disabled={input.horizonMonths >= 12000} onClick={() => { commit({ ...input, horizonMonths: Math.min(12000, input.horizonMonths + 120) }); setPanel(null); }}>さらに10年先まで計算</button></details>}{input.growthPriority.length>0&&<p>育成順：{input.growthPriority.map(s=>`${nodes.find(n=>n.id===s.memberId)?.name ?? s.memberId}を${s.title}まで`).join(" → ")}<button disabled={stale} onClick={()=>{commit({...input,growthPriority:[]});setPanel(null);}}>解除</button></p>}<details><summary>計算の前提・補足</summary><ul>{variant?.warnings.map(w=><li key={w}>{w}</li>)}</ul></details><button disabled={stale} onClick={() => { p.compute(); setPanel(null); }}>再計算</button></Panel>}
    {panel === "search" && <Panel title="配置・育成順の候補を探す" close={() => setPanel(null)}><StrategyAlternatives base={p.base} input={input} band={p.band} selectedId={selected} disabled={stale} adopt={next => { commit(next); setPanel(null); }}/></Panel>}
    {panel === "compare" && <Panel title="変更前と詳しく比べる" close={() => setPanel(null)}><div className="canvas-basis">{([["title", `同じ${input.targetTitle}`], ["members", "同じ人数"], ["month", "同じ時点"]] as const).map(([key, name]) => <button key={key} aria-pressed={basis === key} onClick={() => setBasis(key)}>{name}</button>)}</div>{basis === "members" && <label>人数<select value={comparisonCount} onChange={e => setComparisonCount(Number(e.target.value))}>{CHECKPOINTS.map(n => <option key={n} value={n}>{n.toLocaleString()} ID</option>)}</select></label>}{!p.reference ? <p>組織を動かすと、その前の結果と比べられます。</p> : <><div className="canvas-compare-grid">{[{ name: "変更前", row: comparisonA }, { name: "変更後", row: comparisonB }].map(({ name, row }) => <section key={name}><h3>{name}</h3>{row ? <><strong>{yen(row.recurring)} /月</strong><p>{time(row.month)} · {row.count.toLocaleString()} ID</p><Income row={row} title="総額と内訳"/></> : <p>期間内に未到達</p>}</section>)}</div><p className="canvas-hint">{sameInputs ? "成長前提は同じです。" : "成長前提・出発点などの変更も含みます。配置だけの差ではありません。"}</p></>}</Panel>}
  </div>;
}
