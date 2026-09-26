import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { actionSchema, BANDS, defaultPhase, STRATEGY_VERSION, strategyRequestSchema, type Band, type LeaderGrowthProfile, type Objective, type StrategyContext, type StrategyMonth, type StrategyNode, type StrategyPlanSummary, type StrategyRevision, type StrategySimulationRequest, type StrategySimulationResult, type StrategyVariantResult } from "./shared/strategy";
import { placementNodes } from "./domain/strategy-placement";
import { planConfig } from "./domain/plan";
import { COURSES, TITLE_ORDER, type OrganizationSnapshot } from "./shared/types";
import type { StrategyProgress } from "./domain/strategy";
import StrategyCanvas, { type Comparison } from "./StrategyCanvas";
import TeamPotentialField from "./TeamPotentialField";
import OrganizationResultTree from "./OrganizationResultTree";
import "./strategy.css";

const money = (value: number) => `${Math.round(value).toLocaleString("ja-JP")}円`;
const number = (n: number) => n.toLocaleString("ja-JP");
const elapsed = (n: number | null) => n === null ? "未到達" : n === 0 ? "現在" : `${Math.floor(n / 12)}年${n % 12}か月`;
const labels: Record<Band, string> = { conservative: "保守", standard: "標準", challenge: "挑戦" };
const objectives: Record<Objective, string> = { fastest: "最短タイトル", income: "完成後の収入", balanced: "バランス" };
async function call<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(`/api/v2/strategy${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("ログインの有効期限を確認して再読み込みしてください");
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "処理に失敗しました"); return data as T;
}
function makeRequest(context: StrategyContext): StrategySimulationRequest {
  const root = context.snapshot.members.find((m) => m.parentMemberId === null)!;
  return strategyRequestSchema.parse({ name: "TRDへの配置プラン", rootId: root.id, targetId: root.id, partnerId: null,
    placementMode: "manual", goalBasis: "title", targetIds: 4999,
    leaders: [{ id: "self", name: root.displayName, existingMemberId: root.id, introducerId: root.id, placementId: root.id, startMonth: 1, initialTeam: 0, licenseAfterMonths: null, phases: [defaultPhase()] }],
    ownedMonthlyCosts: {}, courseMonthlyCosts: { A: 9950, B: 19900, F: 13170, G: 26340, I: 0 }, taxes: { [root.id]: context.tax } });
}
function filteredBase(context: StrategyContext, includeTrial: boolean): OrganizationSnapshot {
  if (includeTrial) return structuredClone(context.snapshot);
  const trial = new Set(context.trialIds);
  return { ...structuredClone(context.snapshot), members: context.snapshot.members.filter((m) => !trial.has(m.id)), purchases: context.snapshot.purchases.filter((p) => !trial.has(p.memberId)) };
}

export function Income({ row, title = "報酬の内訳" }: { row: StrategyMonth; title?: string }) {
  return <details className="studio-income"><summary><span>{title}</span><strong>{money(row.gross)}</strong></summary>
    <div className="studio-money-grid">{[["ラインのみ", row.line], ["継続報酬", row.recurring], ["一時報酬", row.gross - row.recurring], ["概算受取額", row.net], ["所有ID購入費", row.costs], ["参考収支", row.cashflow]].map(([label, amount]) => <div key={label}><span>{label}</span><strong>{money(Number(amount))}</strong></div>)}</div>
    <div className="table-scroll"><table><thead><tr><th>ID</th><th>当月 / 取得済</th><th>ライン</th><th>DR</th><th>タイトル</th><th>スタート</th><th>トレーナー</th><th>購入費</th></tr></thead><tbody>{row.ids.map((id) => <tr key={id.id}><th>{id.name}<small>{id.id === id.ownerId ? "メイン" : "サブ"}</small></th><td>{id.title} / {id.acquiredTitle}</td><td>{money(id.line)}</td><td>{money(id.director)}</td><td>{money(id.titleBonus)}</td><td>{money(id.start)}</td><td>{money(id.trainerBonus)}</td><td>{money(id.cost)}</td></tr>)}</tbody></table></div>
    {row.payees.map((p) => <p key={p.id}>{row.ids.find((i) => i.id === p.id)?.name ?? p.id}：控除 {money(Object.values(p.bonus.deductions).reduce((a, b) => a + b, 0))} ／ 受取 {money(p.bonus.estimatedNet)} ／ 翌月繰越 {money(p.bonus.carryover)}</p>)}
    <p>一時報酬と繰越を除いた参考収支：{money(row.recurringCashflow)} ／ 月</p>
    <small>選択したルール・価格が続く前提の概算です。公式明細ではありません。</small>
  </details>;
}
function OrganizationSummary({ nodes }: { nodes: StrategyNode[] }) {
  return <OrganizationResultTree nodes={nodes}/>;
}
function Chart({ variants, band, selected }: { variants: StrategySimulationResult["variants"]; band: Band; selected: Objective }) {
  const [metric, setMetric] = useState<"count" | "recurring" | "cumulative">("count");
  const all = variants.flatMap((v) => v.bands[band].months.map((m) => m[metric]));
  const low = Math.min(0, ...all), high = Math.max(1, ...all);
  const horizon = Math.max(1, ...variants.map((v) => v.bands[band].months.at(-1)!.month));
  const colors = ["#236e57", "#b87c24", "#5076a6"];
  return <section className="panel studio-chart"><div className="studio-heading"><h2>成長と収入の道のり</h2><select aria-label="グラフの指標" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}><option value="count">当月アクティブID</option><option value="recurring">継続報酬</option><option value="cumulative">累計参考収支</option></select></div>
    <svg viewBox="0 0 720 240" role="img" aria-label="3戦略の月次比較グラフ">{[0, 0.5, 1].map((f) => <g key={f}><line x1="70" y1={20 + f * 180} x2="705" y2={20 + f * 180} stroke="#dce7e0"/><text x="65" y={24 + f * 180} textAnchor="end" fontSize="11">{number(Math.round(high - f * (high - low)))}</text></g>)}
      {variants.map((v, i) => <polyline key={v.objective} fill="none" stroke={colors[i]} strokeWidth={v.objective === selected ? 3 : 1.5} points={v.bands[band].months.map((m) => `${70 + m.month / horizon * 635},${200 - (m[metric] - low) / (high - low) * 180}`).join(" ")}/>)}
      <text x="70" y="230" fontSize="12">現在</text><text x="705" y="230" textAnchor="end" fontSize="12">{elapsed(horizon)}</text></svg>
    <div className="studio-legend">{variants.map((v, i) => <span key={v.objective} style={{ color: colors[i] }}>● {objectives[v.objective]}</span>)}</div></section>;
}

export default function StrategyStudio() {
  const [panel, setPanel] = useState<"workspace" | "settings" | "saved" | "qualifications">("workspace");
  const [reference, setReference] = useState<Comparison | null>(null);
  const [context, setContext] = useState<StrategyContext | null>(null);
  const [input, setInput] = useState<StrategySimulationRequest | null>(null);
  const [frozenBase, setFrozenBase] = useState<OrganizationSnapshot | null>(null);
  const [frozenInput, setFrozenInput] = useState<StrategySimulationRequest | null>(null);
  const [result, setResult] = useState<StrategySimulationResult | null>(null);
  const [progress, setProgress] = useState<StrategyProgress | null>(null);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [objective, setObjective] = useState<Objective>("fastest"), [band, setBand] = useState<Band>("standard");
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [plans, setPlans] = useState<StrategyPlanSummary[]>([]);
  const [planId, setPlanId] = useState<string | null>(null), [revisionId, setRevisionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; name: string; created_at: string }>>([]);
  const [previewApply, setPreviewApply] = useState(false);
  const worker = useRef<Worker | null>(null);
  const computationId = useRef(0);
  const workingBase = useMemo(() => frozenBase ?? (context ? filteredBase(context, input?.includeTrial ?? true) : null), [frozenBase, context, input?.includeTrial]);
  useEffect(() => {
    let live = true;
    void Promise.all([call<StrategyContext>("/context"), call<StrategyPlanSummary[]>("/plans")]).then(([c, p]) => { if (!live) return; setContext(c); setInput(makeRequest(c)); setPlans(p); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; worker.current?.terminate(); };
  }, []);
  const update = (patch: Partial<StrategySimulationRequest>) => setInput((i) => i ? { ...i, ...patch } : i);
  const updateLeader = (id: string, patch: Partial<LeaderGrowthProfile>) => update({ leaders: input!.leaders.map((l) => l.id === id ? { ...l, ...patch } : l) });
  const compute = (nextInput = input, reuseBase = frozenBase) => {
    if (!nextInput || !context) return;
    try {
      const checked = strategyRequestSchema.parse({ ...nextInput, name: nextInput.name.trim() || "試算", leaders: nextInput.leaders.map(l => ({ ...l, name: l.name.trim() || "試算" })) });
      const base = reuseBase ?? workingBase ?? filteredBase(context, checked.includeTrial);
      setInput(checked);
      setBusy(true); setError(""); setMessage(""); setRevisionId(null); setProgress(null);
      const job = ++computationId.current;
      const w = worker.current ?? new Worker(new URL("./strategy-worker.ts", import.meta.url), { type: "module" }); worker.current = w;
      w.onmessage = (event: MessageEvent<{ job: number; type: string; progress?: StrategyProgress; result?: StrategySimulationResult; error?: string; cached?: boolean; elapsedMs?: number }>) => {
        if (worker.current !== w || event.data.job !== computationId.current) return;
        if (event.data.type === "progress") setProgress(event.data.progress!);
        if (event.data.type === "result") { setResult(event.data.result!); setFrozenInput(checked); setFrozenBase(base); setBusy(false); setSelectedMonth(0); setMessage(event.data.cached ? "計算済みの案を再表示しました" : `再計算 ${(Number(event.data.elapsedMs) / 1000).toFixed(1)}秒`); }
        if (event.data.type === "error") { setError(event.data.error!); setBusy(false); }
      };
      w.onerror = () => { if (worker.current !== w) return; setError("計算を完了できませんでした。入力を確認して再実行してください"); setBusy(false); w.terminate(); worker.current = null; };
      w.postMessage({ job, request: checked, base });
    } catch (e) { setError(e instanceof Error ? e.message : "入力を確認してください"); }
  };
  const selected = result?.variants.find((v) => v.objective === objective)?.bands[band];
  const row = selected?.months.find((m) => m.month === selectedMonth) ?? selected?.months[0];
  const checkpoint = selected?.checkpoints.find((p) => p.reachedMonth === row?.month);
  const previousCheckpoint = selected?.checkpoints.filter((p) => p.reachedMonth !== null && p.reachedMonth < (row?.month ?? 0)).at(-1)?.snapshot ?? selected?.months[0];
  const dirty = !!result && JSON.stringify(input) !== JSON.stringify(frozenInput);
  const save = async (asNew = false) => {
    if (!frozenInput || !frozenBase || !result) return;
    if (result.engineVersion !== STRATEGY_VERSION) { setError("旧版の保存結果です。新しい案として保存する場合は、先に再計算してください。元の保存結果は残ります。"); return; }
    setSaving(true); setError("");
    try { const saved = await call<{ id: string; planId: string }>("/plans", { planId: asNew ? null : planId, request: frozenInput, base: frozenBase, result }); setPlanId(saved.planId); setRevisionId(saved.id); setPlans(await call("/plans")); setMessage("入力・出発点・結果を新しい版として保存しました"); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const openRevision = async (id: string) => {
    computationId.current++;
    worker.current?.terminate(); worker.current = null; setBusy(false); setProgress(null);
    try { const revision = await call<StrategyRevision>(`/revisions/${id}`); const request = strategyRequestSchema.parse(revision.request); setInput(request); setFrozenInput(request); setFrozenBase(revision.base); setResult(revision.result); setPlanId(revision.planId); setRevisionId(revision.id); setSelectedMonth(0); setVersions(await call(`/plans/${revision.planId}/revisions`)); setMessage("保存時の出発点と結果を表示しています"); setPanel("workspace"); }
    catch (e) { setError((e as Error).message); }
  };
  const refreshBase = async () => {
    try {
      const current = await call<StrategyContext>("/context");
      setContext(current); setFrozenBase(null); setRevisionId(null); setResult(null); setPreviewApply(false);
      setMessage("最新の組織を読み込みました。条件を確認して再計算してください。保存済みの版は残ります");
    } catch (e) { setError((e as Error).message); }
  };
  const template = (kind: string) => {
    if (!input) return;
    const nodes = placementNodes(workingBase ?? context!.snapshot, input);
    const queue = [input.rootId]; const visited = new Set<string>(); let placementId: string | undefined;
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!; if (visited.has(id)) continue; visited.add(id);
      const children = nodes.filter(n => n.parentId === id);
      if (nodes.some(n => n.id === id) && children.length < planConfig.firstLineLimit) { placementId = id; break; }
      queue.push(...children.map(n => n.id));
    }
    if (!placementId) { setError("配置できるIDがありません。配置を見直してください"); return; }
    const p = defaultPhase();
    if (kind === "one" || kind === "three") for (const b of BANDS) p.rates[b] = { introductions: 0, activity: 1, perRecruiter: kind === "one" ? 1 : 3, retention: 1, exitRate: 0, reactivation: 0 };
    p.maxPerMember = kind === "three" ? 3 : kind === "one" ? 1 : 3;
    p.recruitmentDelay = 12;
    const leader: LeaderGrowthProfile = { id: `team-${crypto.randomUUID()}`, name: "試算チーム", existingMemberId: null, introducerId: input.rootId, placementId, startMonth: 1,
      initialTeam: kind === "twenty" ? 19 : kind === "team" ? 10 : kind === "three" ? 3 : kind === "single" ? 0 : 1, leaderCourse: "G", targetWeight: 1, licenseAfterMonths: null, phases: [p] };
    if (kind === "twenty" || kind === "team") for (const b of BANDS) p.rates[b].introductions = 0;
    const next = { ...input, leaders: [...input.leaders, leader] };
    if (!reference && result && !dirty && workingBase) setReference({ input, result, base: workingBase });
    setInput(next); if (panel === "workspace") compute(next);
  };
  if (!context || !input) return <div className="state-card">{error || "Strategy Studioを準備しています…"}</div>;
  const members = (workingBase ?? context.snapshot).members.filter((m) => m.endedPeriod === null);
  const owners = [input.rootId, ...(input.partnerId ? [input.partnerId] : [])];
  const household = members.filter((m) => owners.includes(m.id) || owners.includes(m.masterMemberId ?? ""));
  const cancel = () => { worker.current?.terminate(); worker.current = null; setBusy(false); setProgress(null); setMessage("計算を中止しました。前回の結果は変更後の結果として表示しません。再計算できます。"); };
  if (panel === "workspace") return <div className="studio studio-v3">
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="status-message" role="status">{message}</p>}
    {busy && <p role="status">{progress ? `${labels[progress.band]}・${elapsed(progress.month)}を計算中…` : "計算を開始しています…"}</p>}
    <StrategyCanvas base={workingBase!} input={input} result={result} busy={busy} dirty={dirty} band={band} setBand={setBand} change={setInput} compute={compute}
      settings={() => setPanel("settings")} qualifications={() => setPanel("qualifications")} saved={() => setPanel("saved")} save={() => void save(true)} saving={saving} cancel={cancel} addTeam={template} reference={reference} setReference={setReference}/>
  </div>;
  if (panel === "qualifications") return <div className="studio"><header className="studio-heading"><h1>将来の変更・資格取得予定</h1><button onClick={() => setPanel("workspace")}>試算に戻る</button></header>
    <p>途中で条件を満たす予定を変更できます。実組織の登録情報は変更しません。</p>
    <ActionEditor input={input} update={update} members={members.map(m => ({ id: m.id, name: m.displayName }))} expanded/>
    <button className="primary-button" disabled={busy} onClick={() => { setPanel("workspace"); compute(input); }}>この予定で再計算</button>
  </div>;
  if (panel === "saved") return <div className="studio studio-v3"><div className="studio-heading"><h1>保存したプラン</h1><button onClick={() => setPanel("workspace")}>組織と比較に戻る</button></div><p>入力・出発点・結果を保存時のまま開きます。案Aを基準にして別の案を開くと比較できます。</p>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {plans.length === 0 && <p>保存したプランはまだありません。</p>}{plans.map(p => <section className="panel" key={p.id}><h2>{p.name}</h2><small>{p.updatedAt.slice(0, 10)}</small><div className="studio-actions"><button disabled={busy} onClick={() => void openRevision(p.revisionId)}>プランを開く</button><button disabled={busy} onClick={async () => { try { const r = await call<StrategyRevision>(`/revisions/${p.revisionId}`); setReference({ input: strategyRequestSchema.parse(r.request), result: r.result, base: r.base }); setMessage(`「${r.name}」を比較基準Aに固定しました`); } catch (e) { setError((e as Error).message); } }}>比較基準Aにする</button></div></section>)}
    {versions.length > 0 && <details><summary>開いているプランの過去の版</summary>{versions.map(v => <button key={v.id} disabled={busy} onClick={() => void openRevision(v.id)}>{v.created_at} {v.name}</button>)}</details>}
  </div>;
  return <div className="studio">
    <header className="studio-heading"><h1>前提・詳細設定</h1><button onClick={() => setPanel("workspace")}>組織と比較に戻る</button></header>
    <div className="studio-links"><NavLink to="/legacy/simulator">従来の配置試算</NavLink><NavLink to="/legacy/forecast">従来の将来試算</NavLink><NavLink to="/reference/titles">タイトル条件表</NavLink></div>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="status-message" role="status">{message}</p>}
    <details className="panel studio-settings" open><summary><b>現在地と成長前提</b><span>{input.leaders.length}チーム · {elapsed(input.horizonMonths)}を計算</span></summary>
      <label>試算の基準<select value={input.goalBasis} onChange={e => update({ goalBasis: e.target.value as typeof input.goalBasis, placementMode: "manual", targetIds: e.target.value === "title" ? 4999 : 2000 })}><option value="title">目標タイトルへの到達</option><option value="members">旧形式：2,000 IDへの到達</option></select></label>
      <div className="studio-form"><label>計画名<input value={input.name} onChange={(e) => update({ name: e.target.value })}/></label><label>パートナー<select value={input.partnerId ?? ""} onChange={(e) => update({ partnerId: e.target.value || null, taxes: { ...input.taxes, ...(e.target.value ? { [e.target.value]: context.tax } : {}) } })}><option value="">選択なし</option>{members.filter((m) => m.idKind === "master" && m.id !== input.rootId).map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
      <label>タイトルの目標ID<select value={input.targetId} onChange={(e) => update({ targetId: e.target.value })}>{household.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label><label>目標タイトル<select value={input.targetTitle} onChange={(e) => update({ targetTitle: e.target.value as typeof input.targetTitle })}>{TITLE_ORDER.filter((t) => t !== "NONE").map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>計算年数（期限ではありません）<input type="number" min="1" max="1000" value={input.horizonMonths / 12} onChange={(e) => update({ horizonMonths: Number(e.target.value) * 12 })}/></label><label>バランス案の許容遅れ（％）<input type="number" min="0" max="200" value={input.delayTolerance * 100} onChange={(e) => update({ delayTolerance: Number(e.target.value) / 100 })}/></label>
      <label className="studio-check"><input type="checkbox" checked={input.includeTrial} onChange={(e) => { update({ includeTrial: e.target.checked }); setFrozenBase(null); }}/>現在の仮メンバーも含める</label></div>
      <p>{context.snapshot.period}度を出発点にします。現在 {members.length} ID（仮 {context.trialIds.length} ID）。</p>
      <div className="studio-template">チームを追加：{[["twenty", "20人一括"], ["team", "リーダー＋10人"], ["one", "1人が1人"], ["three", "3人が3人"]].map(([key, text]) => <button key={key} onClick={() => template(key!)} disabled={input.leaders.length >= 12}>{text}</button>)}</div>
      {input.leaders.map((leader) => <details key={leader.id} className="studio-leader"><summary>{leader.name} <small>{elapsed(leader.startMonth)}から · {leader.phases.length}期間</small></summary>
        <div className="studio-form"><label>チーム名<input value={leader.name} onChange={(e) => updateLeader(leader.id, { name: e.target.value })}/></label><label>既存リーダー<select value={leader.existingMemberId ?? ""} onChange={(e) => updateLeader(leader.id, { existingMemberId: e.target.value || null })}><option value="">新規加入する人</option>{members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
        <label>開始月（現在=0）<input type="number" min="1" value={leader.startMonth} onChange={(e) => updateLeader(leader.id, { startMonth: Number(e.target.value) })}/></label><label>最初に連れてくる人数<input type="number" min="0" max="2000" value={leader.initialTeam} onChange={(e) => updateLeader(leader.id, { initialTeam: Number(e.target.value) })}/></label>
        <label>手動の配置先<select value={leader.placementId} onChange={(e) => updateLeader(leader.id, { placementId: e.target.value })}>{members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label><label>紹介者<select value={leader.introducerId} onChange={(e) => updateLeader(leader.id, { introducerId: e.target.value })}>{members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
        {!leader.existingMemberId && <label>リーダー本人の加入コース<select value={leader.leaderCourse} onChange={(e) => updateLeader(leader.id, { leaderCourse: e.target.value as typeof leader.leaderCourse })}>{COURSES.map((c) => <option key={c}>{c}</option>)}</select></label>}
        <label>完成形の人数配分の重み<input type="number" min="0" max="100" step="0.1" value={leader.targetWeight} onChange={(e) => updateLeader(leader.id, { targetWeight: Number(e.target.value) })}/><small>同じ重みなら追加人数を均等配分。0は現状人数までです。全前提でこの配分を固定します。</small></label>
        <label>チームのライセンス取得予定（加入後の月数）<input type="number" min="0" placeholder="未設定" value={leader.licenseAfterMonths ?? ""} onChange={(e) => updateLeader(leader.id, { licenseAfterMonths: e.target.value === "" ? null : Number(e.target.value) })}/></label></div>
        <TeamPotentialField value={leader.potentialDownlineIds} minimum={leader.initialTeam} disabled={busy} change={potentialDownlineIds => updateLeader(leader.id, { potentialDownlineIds })}/>
        {leader.phases.map((phase, pi) => { const set = (patch: Partial<typeof phase>) => updateLeader(leader.id, { phases: leader.phases.map((p, i) => i === pi ? { ...p, ...patch } : p) }); return <section className="studio-phase" key={pi}><div className="studio-form"><label>期間の開始月<input type="number" value={phase.fromMonth} onChange={(e) => set({ fromMonth: Number(e.target.value) })}/></label><label>終了月（空欄=継続）<input type="number" value={phase.toMonth ?? ""} onChange={(e) => set({ toMonth: e.target.value ? Number(e.target.value) : null })}/></label><label>新規のコース<select value={phase.course} onChange={(e) => set({ course: e.target.value as typeof phase.course })}>{COURSES.map((c) => <option key={c}>{c}</option>)}</select></label><label>配下が紹介を始めるまで（月）<input type="number" min="1" value={phase.recruitmentDelay} onChange={(e) => set({ recruitmentDelay: Number(e.target.value) })}/></label><label>配下1人が紹介する累計上限<input type="number" min="0" value={phase.maxPerMember} onChange={(e) => set({ maxPerMember: Number(e.target.value) })}/></label><label>1 IDあたり追加p.v. / 月<input type="number" min="0" value={phase.additionalPv} onChange={(e) => set({ additionalPv: Number(e.target.value) })}/></label></div>
        <div className="studio-bands">{BANDS.map((b) => <fieldset key={b}><legend>{labels[b]}</legend>{([
          ["introductions", "リーダー自身の紹介 / 月", 1], ["activity", "配下の紹介活動率（％）", 100], ["perRecruiter", "活動する人の紹介 / 月", 1], ["retention", "月次購入継続率（％）", 100], ["exitRate", "月次退会率（％）", 100], ["reactivation", "休止者の月次再開率（％）", 100]
        ] as const).map(([key, text, factor]) => <label key={key}>{text}<input type="number" min="0" step="0.01" value={Math.round(phase.rates[b][key] * factor * 1000) / 1000} onChange={(e) => set({ rates: { ...phase.rates, [b]: { ...phase.rates[b], [key]: Number(e.target.value) / factor } } })}/></label>)}</fieldset>)}</div></section>; })}
        <div className="studio-actions"><button onClick={() => { const phases = structuredClone(leader.phases); const last = phases.at(-1)!; const end = last.toMonth ?? last.fromMonth + 23; last.toMonth = end; phases.push({ ...defaultPhase(), fromMonth: end + 1 }); updateLeader(leader.id, { phases }); }}>次の期間を追加</button><button onClick={() => update({ leaders: input.leaders.filter((l) => l.id !== leader.id) })} disabled={input.leaders.length === 1}>このチームを外す</button></div>
      </details>)}
    </details>
    <details className="panel studio-settings"><summary><b>2. 所有ID・費用・下振れの条件</b></summary><div className="studio-form">
      <label className="studio-check"><input type="checkbox" checked={input.allowIntroducerIdChoice} onChange={(e) => update({ allowIntroducerIdChoice: e.target.checked })}/>新規紹介者のIDを本人のメイン・サブ間で比較する</label><small>同じ所有者のID間だけを比較します。他の人を紹介者に変えたり、既存登録を変更したりしません。</small>
      {([['allowSubCreation', 'サブ作成を探索する'], ['allowSubDeletion', 'サブ削除を探索する'], ['allowMove', '仮メンバーのアップ変更を許可'], ['provisionalCompression', 'サブ削除の繰上げルールを採用（暫定・出典未確認）']] as const).map(([key, text]) => <label className="studio-check" key={key}><input type="checkbox" checked={input[key]} onChange={(e) => update({ [key]: e.target.checked })}/>{text}</label>)}
      {COURSES.map((course) => <label key={course}>{course}コース・所有IDの月額購入費<input type="number" min="0" value={input.courseMonthlyCosts[course]} onChange={(e) => update({ courseMonthlyCosts: { ...input.courseMonthlyCosts, [course]: Number(e.target.value) } })}/></label>)}
      <label>下振れテスト<select value={input.stress.kind} onChange={(e) => update({ stress: { ...input.stress, kind: e.target.value as typeof input.stress.kind } })}><option value="none">なし</option><option value="leader-delay">リーダーの開始が遅れる</option><option value="retention-drop">購入継続が落ちる</option><option value="recruitment-stop">新規紹介が止まる</option></select></label><label>対象チーム<select value={input.stress.leaderId ?? ""} onChange={(e) => update({ stress: { ...input.stress, leaderId: e.target.value || null } })}><option value="">全体</option>{input.leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>開始月<input type="number" value={input.stress.fromMonth} onChange={(e) => update({ stress: { ...input.stress, fromMonth: Number(e.target.value) } })}/></label><label>継続月数・遅れ月数<input type="number" value={input.stress.duration} onChange={(e) => update({ stress: { ...input.stress, duration: Number(e.target.value) } })}/></label><label>継続率の低下（ポイント）<input type="number" value={input.stress.retentionDrop * 100} onChange={(e) => update({ stress: { ...input.stress, retentionDrop: Number(e.target.value) / 100 } })}/></label>
      <label>Aさん役の担当ID<select value={input.trainerId ?? ""} onChange={(e) => update({ trainerId: e.target.value || null })}><option value="">なし</option>{household.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label><label>トレーナーの役割<select value={input.trainerRole ?? ""} onChange={(e) => update({ trainerRole: (e.target.value || null) as typeof input.trainerRole })}><option value="">なし</option><option value="PT">Pトレーナー</option><option value="ST_SOLO">Sトレーナー単独</option><option value="ST_WITH_PT">Sトレーナー＋P</option></select></label></div>
      <p>費用は選択商品に合わせて入力してください。Iコースの初期値0円は未入力です。追加購入費も所有IDごとの月額費用に含めてください。</p>
      {household.map((m) => <label key={m.id} className="studio-cost">{m.displayName}の月額費用（空欄=コース額）<input type="number" min="0" value={input.ownedMonthlyCosts[m.id] ?? ""} onChange={(e) => { const costs = { ...input.ownedMonthlyCosts }; if (e.target.value === "") delete costs[m.id]; else costs[m.id] = Number(e.target.value); update({ ownedMonthlyCosts: costs }); }}/></label>)}
      {owners.map((id) => { const tax = input.taxes[id] ?? context.tax; return <details key={id}><summary>{members.find((m) => m.id === id)?.displayName}の控除と繰越</summary><label className="studio-check"><input type="checkbox" checked={tax.invoiceRegistered} onChange={(e) => update({ taxes: { ...input.taxes, [id]: { ...tax, invoiceRegistered: e.target.checked } } })}/>インボイス登録済み</label><div className="studio-form">{([['withholdingRate', '源泉控除率（0〜1）'], ['transferFee', '振込手数料'], ['offsets', '毎月の相殺'], ['priorCarryover', '開始時の繰越']] as const).map(([key, text]) => <label key={key}>{text}<input type="number" step="any" min="0" value={tax[key]} onChange={(e) => update({ taxes: { ...input.taxes, [id]: { ...tax, [key]: Number(e.target.value) } } })}/></label>)}</div></details>; })}
      <ActionEditor input={input} update={update} members={members.map((m) => ({ id: m.id, name: m.displayName }))}/>
    </details>
    <div className="studio-run"><button className="primary-button" disabled={busy} onClick={() => { if (!reference && result && frozenInput && frozenBase) setReference({ input: frozenInput, result, base: frozenBase }); compute(); setPanel("workspace"); }}>この前提で計算して組織に戻る</button>{busy && <button onClick={cancel}>キャンセル</button>}</div>
    {busy && <div className="panel" role="status"><progress value={progress?.completed ?? 0} max={progress?.total ?? 1}/><p>{progress ? `${progress.candidate}・${labels[progress.band]} ／ ${elapsed(progress.month)}を計算中` : "計算を開始しています…"}</p></div>}
    {dirty && <p className="status-message">前提または計算エンジンが更新されています。再計算すると現在の条件で更新されます。</p>}
    {input.goalBasis === "members" && result && selected && row && <>
      <section className="panel"><div className="studio-heading"><h2>3. 戦略を比較</h2><div className="studio-tabs">{BANDS.map((b) => <button key={b} aria-pressed={b === band} onClick={() => { setBand(b); setSelectedMonth(0); }}>{labels[b]}</button>)}</div></div><div className="studio-variants">{result.variants.map((v) => { const r = v.bands[band]; return <button key={v.objective} className={objective === v.objective ? "selected" : ""} onClick={() => { setObjective(v.objective); setSelectedMonth(0); }}><small>{objectives[v.objective]}</small><strong>{r.steady ? money(r.steady.recurring) : "完成形は未到達"}</strong><span>目標タイトル：{elapsed(r.titleMonth)}</span><span>2,000 ID：{elapsed(r.completionMonth)}</span><span>{r.candidate.label}</span></button>; })}</div>
      <p>{result.explored}候補から選んだ案です。{new Set(result.variants.map((v) => v.candidateId)).size < 3 && "同じ案が複数の目的で選ばれています。"} 3つの成長前提は同じ配置方針で比較します。累計収支の比較時点は{elapsed(result.comparisonMonth)}です。</p><small>有限の配置候補から選ぶ比較です。全配置の最適性を保証するものではありません。</small>
      {result.stressImpact.filter((s) => s.objective === objective && s.band === band).map((s) => <p key={s.band}>同じ配置の下振れテスト（{elapsed(s.month)}時点）：アクティブ {number(s.countDelta)} ID ／ 継続報酬 {money(s.recurringDelta)} ／ 累計収支 {money(s.cumulativeDelta)} の差。</p>)}</section>
      <Chart variants={result.variants} band={band} selected={objective}/>
      <section className="panel"><h2>4. 成長ロードマップ</h2><div className="studio-checkpoints"><button aria-pressed={row.month === 0} onClick={() => setSelectedMonth(0)}>現在</button>{selected.checkpoints.map((c) => <button key={c.memberCount} disabled={!c.reached} aria-pressed={c.reachedMonth === row.month} onClick={() => setSelectedMonth(c.reachedMonth!)}><b>{number(c.memberCount)} ID</b><span>{elapsed(c.reachedMonth)}</span><small>{c.reached ? `実数 ${number(c.actualCount)} ID` : `あと ${number(c.remaining)} ID`}</small></button>)}</div>
      <label className="studio-slider">月を選択：{row.period}度 ／ {elapsed(row.month)}<input type="range" min="0" max={selected.months.at(-1)!.month} value={row.month} onChange={(e) => setSelectedMonth(Number(e.target.value))}/></label>
      <div className="studio-money-grid">{[["当月アクティブ", `${number(row.count)} ID`], ["在籍 / 休止", `${number(row.enrolled)} / ${number(row.inactive)} ID`], ["目標IDのタイトル", row.targetTitle], ["グループp.v.", number(row.pv)], ["累計参考収支", money(row.cumulative)], ["所有サブ", `${row.ownedSubs} ID`]].map(([text, value]) => <div key={text}><span>{text}</span><strong>{value}</strong></div>)}</div><Income row={row}/>
      {row.missing.length > 0 && <details><summary>目標タイトルまでに必要な条件</summary><ul>{row.missing.map((m) => <li key={m}>{m}</li>)}</ul></details>}{row.changes.length > 0 && <ul>{row.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
      {checkpoint && previousCheckpoint && row.month > 0 && <details><summary>前のチェックポイントからの変化</summary><p>アクティブ {number(row.count - previousCheckpoint.count)} ID ／ p.v. {number(row.pv - previousCheckpoint.pv)} ／ 継続報酬 {money(row.recurring - previousCheckpoint.recurring)}</p>{row.ids.map((id) => { const before = previousCheckpoint.ids.find((p) => p.id === id.id); return <p key={id.id}>{id.name}：{before?.title ?? "未登録"} → {id.title}、ライン {money(id.line - (before?.line ?? 0))}・DR {money(id.director - (before?.director ?? 0))}・タイトル {money(id.titleBonus - (before?.titleBonus ?? 0))}</p>; })}</details>}
      {checkpoint && <OrganizationSummary nodes={checkpoint.organization}/>}</section>
      <section className="panel"><h2>5. 2,000 IDの完成形</h2>{selected.completion ? <><p>{elapsed(selected.completionMonth)}で到達。完成後12か月の平均参考収支 {selected.postCompletionAverage === null ? "計算範囲外" : money(selected.postCompletionAverage)}。</p><OrganizationSummary nodes={selected.finalOrganization}/>{selected.steady && <Income row={selected.steady} title="新規一時ボーナスを除いた完成月"/>}</> : <><p>{selected.status === "stalled" ? "現在の成長前提では到達しません。" : selected.status === "missing-assumptions" ? "成長前提が設定されていない期間があります。" : `${elapsed(input.horizonMonths)}の計算範囲では未到達です。`} 完成時の金額は未算出です。</p><p>2,000 IDへの目標配分（到達実績ではありません）</p><div className="studio-tree">{selected.finalDesign.lines.map((line) => <div key={line.leaderId}>{input.leaders.find((l) => `strategy-${l.id}` === line.leaderId || l.existingMemberId === line.leaderId)?.name ?? line.leaderId}：{number(line.quota)} ID ／ 配置先 {members.find((m) => m.id === line.parentId)?.displayName ?? line.parentId}</div>)}</div><details><summary>計算終了時の組織を見る</summary><OrganizationSummary nodes={selected.finalOrganization}/></details></>}
      {!selected.completion && <p>直近12か月以内の平均純増：{selected.recentMonthlyGrowth.toFixed(1)} ID / 月。{selected.referenceArrivalMonth === null ? "この増加速度からは到達時期を算出できません。" : `同じ純増が続く場合の単純延長：${elapsed(selected.referenceArrivalMonth)}。月次再計算による到達結果とは別の目安です。`}</p>}
      <p>完成形の固定配分：対象外の既存在籍・予定サブ {number(selected.finalDesign.fixedMembers)} ID ＋ 各チーム {number(selected.finalDesign.lines.reduce((s, l) => s + l.quota, 0))} ID。各チームは重複なしで数えます。未配分 {number(selected.finalDesign.remaining)} ID。</p>
      <p>目標タイトル取得後の未維持：{selected.maintenanceFailures}か月</p>{selected.pendingActions.length > 0 && <p>実行条件待ちの操作：{selected.pendingActions.join("、")}</p>}
      <details><summary>試算の前提と注意点</summary>{selected.warnings.map((w) => <p key={w}>{w}</p>)}<p>ルール：{result.planVersion}</p></details>
      {result.crossovers.map((c) => <p key={`${c.left}-${c.right}`}>{objectives[c.right]}が{objectives[c.left]}の累計収支を追い越す時期：{c.month === null ? "共通の計算期間内では逆転なし" : elapsed(c.month)}</p>)}</section>
      <section className="panel"><h2>6. 保存して見直す</h2><div className="studio-actions"><button className="primary-button" disabled={dirty || saving || busy} onClick={() => void save()}>{saving ? "保存中…" : planId ? "新しい版として保存" : "この計画を保存"}</button><button disabled={!revisionId || dirty || busy} onClick={() => setPreviewApply(!previewApply)}>試算組織への反映を確認</button><button disabled={busy} onClick={() => void refreshBase()}>現在の組織から見直す</button></div>
      {previewApply && revisionId && planId && <div className="studio-apply"><p>「{input.name}」の{objectives[objective]}・{labels[band]}を組織画面に表示します。既存の実組織は保持し、将来の{selected.months.length - 1}か月分を計画として重ねます。</p><button className="primary-button" onClick={async () => { try { await call(`/plans/${planId}/apply`, { revisionId, objective, band }); setPreviewApply(false); setMessage("試算組織に計画を反映しました"); } catch (e) { setError((e as Error).message); } }}>この計画を反映</button></div>}
      {planId && <button disabled={dirty || saving || busy} onClick={() => void save(true)}>別の計画として保存</button>}
      {frozenBase && <p>出発点：{frozenBase.period}度。現在の組織との差：在籍 {members.length - frozenBase.members.filter((m) => m.endedPeriod === null).length} ID。</p>}</section>
    </>}
    <section className="panel"><h2>保存した計画</h2>{plans.length === 0 && <p>保存した計画はまだありません。</p>}{plans.map((p) => <div className="studio-saved" key={p.id}><button disabled={busy} onClick={() => void openRevision(p.revisionId)}><strong>{p.name}</strong><small>{p.updatedAt.slice(0, 10)} {p.archived ? "保管済み" : ""}</small></button><button onClick={async () => { try { await call("/archive", { planId: p.id, archived: !p.archived }); setPlans(await call("/plans")); } catch (e) { setError((e as Error).message); } }}>{p.archived ? "戻す" : "保管する"}</button></div>)}
      {versions.length > 0 && <details><summary>この計画の過去の版</summary>{versions.map((v) => <button key={v.id} onClick={() => void openRevision(v.id)}>{v.created_at} {v.name}</button>)}</details>}
      {context.legacy.length > 0 && <details><summary>旧版の保存試算（{context.legacy.length}件）</summary><p>保存時の結果をそのまま保持しています。リーダー別の前提は新しく設定してください。</p>{context.legacy.map((l) => <details key={l.id}><summary>{l.name}</summary>{l.results.map((r) => <div key={r.scenarioId}>{r.scenarioId}{r.months.map((m) => <p key={m.period}>{m.period}：{m.groupMembers} ID・{m.title}・{money(m.gross)}</p>)}</div>)}</details>)}</details>}</section>
    <p className="disclaimer">非公式・個人用の条件付き試算です。長期の金額は選択した報酬ルールと価格が続く前提です。</p>
  </div>;
}

function ActionEditor({ input, update, members, expanded = false }: { input: StrategySimulationRequest; update: (patch: Partial<StrategySimulationRequest>) => void; members: Array<{ id: string; name: string }>; expanded?: boolean }) {
  const owners = [input.rootId, ...(input.partnerId ? [input.partnerId] : [])];
  const choices = [...members, ...input.leaders.filter((l) => !l.existingMemberId).map((l) => ({ id: `strategy-${l.id}`, name: l.name })),
    ...input.actions.filter((a) => a.kind === "create-sub").map((a) => ({ id: a.memberId, name: "作成予定のサブ" })),
    ...owners.flatMap((owner) => Array.from({ length: 3 }, (_, i) => ({ id: `strategy-sub-${owner}-${i}`, name: `${members.find((m) => m.id === owner)?.name}の探索サブ ${i + 1}` })))];
  return <details open={expanded || undefined}><summary>資格取得・サブ・アップ変更の操作予定（{input.actions.length}件）</summary>
    <p>指定月以降、必要なタイトルが成立した時に実行します。資格は受講などの予定と人数条件がそろった時に取得として計算します。</p>
    {input.actions.map((action, index) => { const set = (patch: Partial<typeof action>) => update({ actions: input.actions.map((a, i) => i === index ? { ...a, ...patch } : a) });
      return <fieldset key={action.id} className="studio-leader"><legend>操作 {index + 1}</legend><div className="studio-form">
        <label>操作<select value={action.kind} onChange={(e) => set({ kind: e.target.value as typeof action.kind, memberId: e.target.value === "create-sub" ? `strategy-manual-sub-${action.id}` : input.rootId })}><option value="qualification">資格・ライセンス取得</option><option value="create-sub">サブ作成</option><option value="delete-sub">サブ削除・繰上げ</option><option value="move">仮メンバーのアップ変更</option><option value="change-course">コース変更</option></select></label>
        <label>開始からの月数<input type="number" min="1" value={action.month} onChange={(e) => set({ month: Number(e.target.value) })}/></label>
        {action.kind !== "create-sub" && <label>対象ID<select value={action.memberId} onChange={(e) => set({ memberId: e.target.value })}>{choices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        {action.kind === "create-sub" && <><label>所有者<select value={action.ownerId ?? input.rootId} onChange={(e) => set({ ownerId: e.target.value })}>{owners.map((id) => <option key={id} value={id}>{members.find((m) => m.id === id)?.name}</option>)}</select></label><label>コース<select value={action.course} onChange={(e) => set({ course: e.target.value as typeof action.course })}>{COURSES.map((c) => <option key={c}>{c}</option>)}</select></label></>}
        {action.kind === "change-course" && <label>変更先コース<select value={action.course} onChange={(e) => set({ course: e.target.value as typeof action.course })}>{COURSES.map((c) => <option key={c}>{c}</option>)}</select></label>}
        {(action.kind === "create-sub" || action.kind === "move") && <label>配置親<select value={action.parentId ?? input.rootId} onChange={(e) => set({ parentId: e.target.value })}>{choices.filter((m) => m.id !== action.memberId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        <label>実行を待つID<select value={action.requiredMemberId ?? ""} onChange={(e) => set({ requiredMemberId: e.target.value || null })}><option value="">待つ条件なし</option>{choices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {action.requiredMemberId && <label>必要なタイトル<select value={action.requiredTitle} onChange={(e) => set({ requiredTitle: e.target.value as typeof action.requiredTitle })}>{TITLE_ORDER.map((t) => <option key={t}>{t}</option>)}</select></label>}
        {action.kind === "qualification" && <><label className="studio-check"><input type="checkbox" checked={action.sponsorLicense} onChange={(e) => set({ sponsorLicense: e.target.checked })}/>スポンサーライセンス取得</label><label>トレーナー講習<select value={action.trainerCredential} onChange={(e) => set({ trainerCredential: e.target.value as typeof action.trainerCredential })}><option value="NONE">設定なし</option><option value="PT">Pトレーナー</option><option value="ST">Sトレーナー</option></select></label><label>スタジオ参加累計<input type="number" min="0" value={action.studioAttendances} onChange={(e) => set({ studioAttendances: Number(e.target.value) })}/></label><label className="studio-check"><input type="checkbox" checked={action.courseCompleted} onChange={(e) => set({ courseCompleted: e.target.checked })}/>講習受講予定</label><label className="studio-check"><input type="checkbox" checked={action.kitPurchased} onChange={(e) => set({ kitPurchased: e.target.checked })}/>キット購入予定</label></>}
      </div><button onClick={() => update({ actions: input.actions.filter((a) => a.id !== action.id) })}>操作を外す</button></fieldset>;
    })}
    <button onClick={() => update({ actions: [...input.actions, actionSchema.parse({ id: crypto.randomUUID(), kind: "qualification", month: 1, memberId: input.rootId, parentId: input.rootId, ownerId: input.rootId, requiredMemberId: null })] })}>操作予定を追加</button>
  </details>;
}

export function StrategyOverlay() {
  const [overlay, setOverlay] = useState<{ name: string; variant: StrategyVariantResult } | null>(null);
  const [month, setMonth] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { void call<typeof overlay>("/overlay").then(setOverlay).catch((e: Error) => setError(e.message)); }, []);
  if (!overlay) return error ? <p role="alert">計画の読込：{error}</p> : null;
  const row = overlay.variant.months[month] ?? overlay.variant.months[0]!;
  const checkpoint = overlay.variant.checkpoints.find((p) => p.reachedMonth === row.month);
  return <section className="panel studio"><div className="studio-heading"><h2>反映中の計画：{overlay.name}</h2><NavLink to="/simulator">Strategy Studioへ</NavLink></div><label className="studio-slider">計画の時点：{elapsed(row.month)} ／ {row.period}度<input type="range" min="0" max={overlay.variant.months.length - 1} value={month} onChange={(e) => setMonth(Number(e.target.value))}/></label><p>計画 {number(row.count)} ID・{row.targetTitle}（実組織とは別の試算）</p><Income row={row}/>{checkpoint ? <OrganizationSummary nodes={checkpoint.organization}/> : <p>組織の配置図は各チェックポイント到達月で確認できます。</p>}{error && <p role="alert">{error}</p>}<button onClick={async () => { try { await call("/overlay", undefined, "DELETE"); setOverlay(null); } catch (e) { setError((e as Error).message); } }}>計画の表示を解除</button></section>;
}
