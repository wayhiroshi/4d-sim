import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { playgroundSample, addPlaygroundPerson, addPlaygroundSub, setPlaygroundSubDr } from "./domain/placement-playground";
import { planConfig } from "./domain/plan";
import { TITLE_ORDER } from "./shared/types";
import { movePlacement, placementError, placementNodes } from "./domain/strategy-placement";
import type { StrategySimulationRequest, StrategyVariantResult } from "./shared/strategy";
import "./placement-playground.css";
import PlaygroundBreakdown from "./PlaygroundBreakdown";

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;
const duration = (n: number | null | undefined) => n == null ? "10年以内には未達" : n === 0 ? "現在" : `${Math.floor(n / 12)}年${n % 12 ? `${n % 12}か月` : ""}`;
type State = { request: StrategySimulationRequest; result: StrategyVariantResult };
export default function PlacementPlayground() {
  const [sample] = useState(playgroundSample), [request, setRequest] = useState(sample.request);
  const [result, setResult] = useState<StrategyVariantResult | null>(null), [before, setBefore] = useState<State | null>(null);
  const [history, setHistory] = useState<StrategySimulationRequest[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [adding, setAdding] = useState<string | null>(null), [destination, setDestination] = useState("");
  const [month, setMonth] = useState(120), [details, setDetails] = useState(false), [action, setAction] = useState("");
  const [folded, setFolded] = useState<string[]>([]);
  const [addingKind, setAddingKind] = useState("member");
  const drag = useRef<string | null>(null), worker = useRef<Worker | null>(null), job = useRef(0), dialog = useRef<HTMLDialogElement>(null);
  const resultPanel = useRef<HTMLElement>(null);
  useEffect(() => { const w = new Worker(new URL("./strategy-worker.ts", import.meta.url), { type: "module" }); worker.current = w; return () => { w.terminate(); worker.current = null; }; }, []);
  useEffect(() => {
    const w = worker.current!, id = ++job.current; setBusy(true); setError("");
    w.onmessage = (event: MessageEvent<{job: number; type: string; result?: StrategyVariantResult; error?: string}>) => {
      if (event.data.job !== job.current) return;
      if (event.data.type === "result") { setResult(event.data.result!); setBusy(false); }
      if (event.data.type === "error") { setError("計算できませんでした。元に戻して、もう一度試してください。"); setBusy(false); }
    };
    w.onerror = () => { setBusy(false); setError("計算が中断しました。画面を再読み込みしてください。"); };
    w.postMessage({ job: id, base: sample.base, request, mode: "preview", band: "standard" });
  }, [request, sample]);
  useEffect(() => { if (adding) dialog.current?.showModal(); }, [adding]);
  useEffect(() => { if (!busy && action && resultPanel.current && resultPanel.current.getBoundingClientRect().top < 60) resultPanel.current.scrollIntoView({block:"start"}); }, [busy, action]);
  const nodes = placementNodes(sample.base, request), person = nodes.find(n => n.id === selected);
  const row = !busy ? result?.months.find(m => m.month === month) : null, oldRow = before?.result.months.find(m => m.month === month);
  const metrics = new Map(row?.organization?.map(n => [n.id, n]) ?? []);
  const displayedNodes = nodes.map(n => ({ ...n, parentId: metrics.get(n.id)?.parentId ?? n.parentId }));
  const hasDrPriority = (id: string) => request.growthPriority.some(p => p.memberId === id && p.title === "DR");
  const subDrPriority = !!person && hasDrPriority(person.id);
  const subCount = nodes.filter(n => n.sub && n.ownerId === request.rootId).length;
  function change(next: StrategySimulationRequest, reason: string) {
    if (busy || !result) return;
    setBefore({ request, result }); setHistory(h => [...h, request]); setRequest(next); setAction(reason); setSelected(null); setDestination("");
  }
  function move(id: string, parent: string) {
    try { const target = nodes.find(n => n.id === parent)!; change(movePlacement(sample.base, request, id, parent), `${nodes.find(n => n.id === id)?.name}を${target.name}の下へ${target.planned ? "加入後に移す試算にしました" : "移しました"}。`); }
    catch (e) { setError((e as Error).message); }
  }
  function undo() {
    const previous = history.at(-1); if (!previous || busy || !result) return;
    setBefore({ request, result }); setHistory(h => h.slice(0, -1)); setRequest(previous); setAction("一つ前の試算に戻しました。"); setSelected(null);
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const next = addingKind === "sub" ? addPlaygroundSub(sample.base, request, adding!, String(data.get("name"))) : addPlaygroundPerson(request, adding!, String(data.get("name")), Number(data.get("potential")));
      const added = placementNodes(sample.base, next).find(n => !nodes.some(old => old.id === n.id))!;
      change(next, `${added.name}を${nodes.find(n => n.id === adding)?.name}の下へ追加しました。${added.sub ? "自分の収入に合算します。" : ""}`); setAdding(null);
    }
    catch(e) { setError((e as Error).message); }
  }
  function tree(id: string): ReactNode {
    const n = nodes.find(n => n.id === id)!; const children = displayedNodes.filter(c => c.parentId === id), m = metrics.get(id);
    const priority = hasDrPriority(id);
    const subDrMonth = !busy && n.sub ? result?.months.find(m => m.ids.some(i => i.id === id && TITLE_ORDER.indexOf(i.acquiredTitle) >= TITLE_ORDER.indexOf("DR")))?.month : undefined;
    const other = m ? Math.max(0, m.count - children.reduce((sum,c) => sum + (metrics.has(c.id) ? metrics.get(c.id)!.count + 1 : 0),0)) : 0;
    return <li key={id}><div className={`try-person ${selected === id ? "chosen" : ""}`} draggable={!busy && id !== request.rootId}
      onDragStart={e => { e.stopPropagation(); drag.current = id; e.dataTransfer.setData("text/plain", id); }} onDragEnd={() => {drag.current = null;}}
      onDragOver={e => { if (drag.current && !placementError(nodes, drag.current, id, request.rootId)) e.preventDefault(); }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); if (drag.current) move(drag.current, id); drag.current = null; }}>
      <button className="try-name" disabled={busy} onClick={() => {setSelected(selected === id ? null : id); setDestination("");}}><small>{id === request.rootId ? "自分のメイン" : n.sub ? "自分が所有するサブID" : n.planned ? "試しに追加した人" : "メンバー"}</small><strong>{n.name}</strong><span>{m ? `配下 ${m.count.toLocaleString()} ID · ${m.title === "NONE" ? "タイトルなし" : m.title}` : busy ? "計算中…" : "この時点では加入前"}</span>{n.sub && <span className="try-title-state">{priority ? "育て方：DRを優先" : "育て方：今のまま（押して変更）"}{!busy && priority && <><br/>{subDrMonth == null ? "この前提では10年以内にDR未達" : `DR初取得：${duration(subDrMonth)}後`}</>}</span>}</button>
      {!!children.length && <button aria-label={`${n.name}の配下を${folded.includes(id) ? "開く" : "閉じる"}`} onClick={() => setFolded(f => f.includes(id) ? f.filter(x => x !== id) : [...f,id])}>{folded.includes(id) ? "＋" : "−"}</button>}
    </div>{!folded.includes(id) && (children.length > 0 || other > 0) && <ul>{children.map(c => tree(c.id))}{other > 0 && <li className="try-aggregate">この下で増えるメンバー <b>{other.toLocaleString()} ID</b></li>}</ul>}</li>;
  }
  const changes = row && oldRow ? row.ids.map(i => ({ name: i.name, delta: i.recurring - (oldRow.ids.find(o => o.id === i.id)?.recurring ?? 0) })).filter(i => i.delta !== 0) : [];
  return <div className="placement-try">
    <header><span className="try-tag">匿名サンプルでお試し</span><h1>どこに置くと、どう変わる？</h1><p>人を追加・移動して、月額とTRDまでの時間を比べます。</p><strong className="try-safe">実際の登録は変わりません</strong></header>
    <section ref={resultPanel} className="try-results" aria-label="配置を変えた結果" aria-busy={busy}>
      <div><span>{month === 0 ? "現在" : `${duration(month)}後`}の月額報酬</span><small>自分＋自分のサブ · 一時ボーナスを除く</small><strong>{row ? yen(row.recurring) : busy ? "計算中…" : "計算できませんでした"}</strong>{row && oldRow && <span>直前 {yen(oldRow.recurring)} → <b>{row.recurring - oldRow.recurring >= 0 ? "+" : ""}{yen(row.recurring - oldRow.recurring)}</b></span>}</div>
      <div><span>あなたがTRDになるまで</span><strong>{busy ? "計算中…" : duration(result?.titleMonth)}</strong>{before && !busy && <small>直前：{duration(before.result.titleMonth)}</small>}<button disabled={!row} onClick={() => setDetails(!details)}>{details ? "内訳を閉じる" : "金額・タイトルの内訳"}</button></div>
      <p role="status">{busy ? "配置から計算しています…" : action || "まず、組織図の人を選んでみてください。"}{!busy && changes.length > 0 && <span> 月額の変化：{changes.map(c => `${c.name} ${c.delta > 0 ? "+" : ""}${yen(c.delta)}`).join("、")}。</span>}{!busy && before && !changes.length && " この時点の月額は変わりません。"}</p>
    </section>
    {details && row && <PlaygroundBreakdown row={row} previous={oldRow}/>}
    {error && <p role="alert" className="try-error">{error}</p>}
    <div className="try-time"><label>いつの組織を見る？ <b>{month === 0 ? "現在" : `${duration(month)}後`}</b><input type="range" aria-label="何か月後の組織を見るか" min="0" max="120" step="12" value={month} disabled={busy} onChange={e => setMonth(Number(e.target.value))}/></label><span>現在 → 10年後</span></div>
    <div className="try-tools"><h2>試しに配置する</h2><button disabled={!history.length || busy} onClick={undo}>一つ前に戻す</button></div>
    <div className="try-layout"><section className="try-tree" aria-label="試し配置の組織図"><p>名前を押すと、追加・移動やサブの育て方を選べます。</p><ul>{tree(request.rootId)}</ul></section>
    {person ? <aside className="try-actions" aria-label={`${person.name}の操作`}><div><h2>{person.name}</h2><button aria-label="操作を閉じる" onClick={() => setSelected(null)}>閉じる</button></div><button className="try-primary" disabled={busy} onClick={() => {setAddingKind(request.leaders.length >= 12 ? "sub" : "member");setAdding(person.id);}}>この人の下に追加</button>
      {person.sub && <fieldset className="try-sub-choice"><legend>サブをDRまで育てる？</legend><div><button type="button" disabled={busy} aria-pressed={!subDrPriority} onClick={() => {if (subDrPriority) change(setPlaygroundSubDr(request, false, person.id), `${person.name}の育て方を「今のまま」に戻しました。`);}}>今のまま</button><button type="button" disabled={busy} aria-pressed={subDrPriority} onClick={() => {if (!subDrPriority) change(setPlaygroundSubDr(request, true, person.id), `これからの紹介を${person.name}側に振り分け、DR取得を優先しました。`);}}>DRを優先</button></div><p>{person.planned ? "これから追加するサブです。" : "現在はDRではありません。"}「DRを優先」では、これからの紹介先と配置をサブの条件に合わせます。</p><small>DRになる時期と月額も計算し直します。</small></fieldset>}
      {person.id !== request.rootId && <form onSubmit={e => {e.preventDefault();move(person.id,destination);}}><label>どこへ移す？<select value={destination} onChange={e => setDestination(e.target.value)} required><option value="">移動先を選ぶ</option>{nodes.filter(n => !placementError(nodes, person.id, n.id, request.rootId)).map(n => <option key={n.id} value={n.id}>{n.name}の下</option>)}</select></label><button disabled={busy || !destination}>ここへ移す</button><small>配下のチームも一緒に移動します。</small></form>}
    </aside> : <aside className="try-next"><h2>誰の下で試しますか？</h2><p>例えば「あなたのサブ」を選ぶと、その下に新しい人を置けます。</p></aside>}</div>
    <details className="try-assumptions"><summary>試算に使っている条件</summary><p>これは操作確認用の架空の組織です。現在の4 IDはGコース・ライセンス取得済みと設定しています。新しい人は翌月Gコースで加入し、12か月後にライセンスを取得する前提です。</p><p>成長は既存エンジンの標準設定（月0.5人の直接紹介、配下の活動率10%、活動者の月紹介0.5人、購入継続率99%）。Aさん・Bさんの配下上限は各300 IDです。達成・収入を保証するものではありません。</p><p>試し配置はこの画面内だけに保持され、再読み込みで元に戻ります。</p><NavLink to="/simulator">従来の詳しい試算を開く</NavLink></details>
    {adding && <dialog ref={dialog} onCancel={() => setAdding(null)} aria-label="メンバー・サブを試しに追加"><form onSubmit={add}><h2>{nodes.find(n => n.id === adding)?.name}の下に追加</h2><label>追加する種類<select value={addingKind} onChange={e => setAddingKind(e.target.value)}><option value="member" disabled={request.leaders.length >= 12}>通常のメンバー</option><option value="sub">自分のサブID</option></select></label><label>呼び名<input name="name" placeholder={addingKind === "sub" ? "例：自分のサブ2" : "例：Cさん"} maxLength={80}/></label>{addingKind === "member" ? <label>将来、その人の下に何IDくらい増えそう？<input name="potential" type="number" defaultValue="100" min="0" max="4999" required/></label> : <p>自分の収入に合算します。サブの購入費も差し引きます。<br/>サブは追加予定を含め {subCount} / {planConfig.maxSubIdsPerMaster} ID。配下の人は追加後に配置できます。</p>}<p>Gコース・翌月加入、12か月後にライセンス取得の前提です。</p>{addingKind === "sub" && subCount >= planConfig.maxSubIdsPerMaster && <p role="alert">サブIDは上限に達しています。</p>}<button className="try-primary" disabled={addingKind === "sub" ? subCount >= planConfig.maxSubIdsPerMaster : request.leaders.length >= 12}>追加して試す</button><button type="button" onClick={() => setAdding(null)}>やめる</button></form></dialog>}
  </div>;
}
