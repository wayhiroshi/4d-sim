import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api";
import {
  COURSES,
  TITLE_ORDER,
  type CourseCode,
  type ForecastResult,
  type ForecastScenario,
  type Goal,
  type Member,
  type OrganizationSnapshot,
  type PlacementResult,
  type TaxProfile,
  type TitleChecklistItem,
  type TitleCode
} from "./shared/types";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ja-JP");
const DEFAULT_TAX: TaxProfile = { invoiceRegistered: false, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 };

function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    void loader().then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "読み込みに失敗しました")).finally(() => setLoading(false));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

function PageState({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (loading) return <div className="state-card">データを読み込んでいます…</div>;
  if (error) return <div className="state-card error">{error}</div>;
  return <>{children}</>;
}

const navItems = [
  ["/", "⌂", "ホーム"], ["/organization", "⌘", "組織"],
  ["/simulator", "◇", "配置試算"], ["/forecast", "↗", "将来試算"], ["/more", "•••", "その他"]
] as const;

function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">FN</div>
        <div><strong>FORDAYS Navigator</strong><span>非公式・個人用</span></div>
        <div className="security-pill">Access保護</div>
      </header>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/organization" element={<Organization />} />
          <Route path="/products" element={<Products />} />
          <Route path="/simulator" element={<Simulator />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/imports" element={<Imports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/reference/titles" element={<TitleReference />} />
          <Route path="/more" element={<More />} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {navItems.map(([to, icon, label]) => <NavLink key={to} to={to} end={to === "/"}><span>{icon}</span>{label}</NavLink>)}
      </nav>
    </div>
  );
}

function Dashboard() {
  const { data, error, loading } = useLoad(api.dashboard, []);
  return (
    <PageState loading={loading} error={error}>
      {data && <>
        <section className="hero-card">
          <div className="level-row"><span>Lv.{Math.max(1, TITLE_ORDER.indexOf(data.title.achievedTitle) + 1)}</span><span>{data.period}度</span></div>
          <p className="eyebrow">CURRENT TITLE</p>
          <h1>{data.title.achievedTitle === "NONE" ? "チャレンジャー" : data.title.achievedTitle}</h1>
          <div className="progress-label"><span>{data.title.nextTitle ?? "最高タイトル"}への進捗</span><strong>{data.title.progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${data.title.progress}%` }} /></div>
        </section>
        <div className="metric-grid">
          <Metric label="グループ p.v." value={`${number.format(data.groupPv)} p.v.`} accent />
          <Metric label="グループ人数" value={`${number.format(data.groupMembers)}人`} />
          <Metric label="総ボーナス" value={yen.format(data.bonus.gross)} />
          <Metric label="概算手取" value={yen.format(data.bonus.estimatedNet)} />
        </div>
        <section className="simulation-actions" aria-label="主な試算">
          <NavLink to="/simulator" className="simulation-action"><span>◇</span><div><strong>配置を試算</strong><small>全配置を再計算して上位3案を比較</small></div></NavLink>
          <NavLink to="/forecast" className="simulation-action"><span>↗</span><div><strong>将来を試算</strong><small>3・6・12か月の条件別シナリオ</small></div></NavLink>
        </section>
        <section className="panel mission-panel">
          <div className="panel-title"><div><p className="eyebrow">SIMULATION CHECK</p><h2>試算で確認すること</h2></div><span className="status-chip">最大5件</span></div>
          <ol className="mission-list">
            {data.missions.map((mission) => <li key={mission.id}><span className="mission-check" /><div><strong>{mission.title}</strong><p>{mission.reason}</p></div></li>)}
          </ol>
        </section>
        <section className="panel">
          <div className="panel-title"><h2>次タイトルの条件</h2><span className="status-chip">公式ルール</span></div>
          <div className="condition-list">
            {data.title.conditions.map((condition) => <div key={condition.key} className={condition.met ? "condition met" : "condition"}><span>{condition.met ? "✓" : ""}</span><div><strong>{condition.label}</strong><small>現在 {String(condition.current)} / 必要 {String(condition.required)}</small></div></div>)}
          </div>
        </section>
        <p className="disclaimer">参考シミュレーションです。正式な資格・報酬はフォーデイズ公式明細で確認してください。収入や効果を保証するものではありません。</p>
      </>}
    </PageState>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className={accent ? "metric accent" : "metric"}><span>{label}</span><strong>{value}</strong></div>;
}

function Organization() {
  const { data, error, loading, reload } = useLoad(api.simulationOrganization, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const snapshot = data?.snapshot ?? null;
  const trialIds = useMemo(() => new Set(data?.simulationMembers.map((member) => member.id) ?? []), [data]);
  const selected = snapshot?.members.find((member) => member.id === selectedId) ?? snapshot?.members[0] ?? null;
  const addTrial = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!snapshot) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setMessage(null);
    try {
      await api.createSimulationMember({
        displayName: String(values.get("name")),
        course: String(values.get("course")) as CourseCode,
        parentMemberId: String(values.get("parent")),
        period: snapshot.period
      });
      form.reset();
      setMessage("仮メンバーを試算中の組織へ追加しました");
      reload();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "追加できませんでした"); }
    finally { setBusy(false); }
  };
  const clearTrials = async () => {
    if (!snapshot || !window.confirm("この営業月の仮メンバーをすべて削除しますか？実組織には影響しません。")) return;
    setBusy(true); setMessage(null);
    try { const result = await api.clearSimulationMembers(snapshot.period); setMessage(`${result.deleted}人の仮メンバーを削除しました`); setSelectedId(null); reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "削除できませんでした"); }
    finally { setBusy(false); }
  };
  return <PageState loading={loading} error={error}>{data && <>
    <PageHeading kicker="ORGANIZATION" title="組織ツリー" description="実組織に仮メンバーを重ねて、複数人の配置を試算します" />
    <section className="trial-banner"><div><strong>試算中 {data.simulationMembers.length}人</strong><small>点線のカードは仮メンバーです。実際の登録データには反映されません。</small></div>{data.simulationMembers.length > 0 && <button className="text-button danger-text" disabled={busy} onClick={() => void clearTrials()}>仮メンバーを全削除</button>}</section>
    <form className="panel trial-form" onSubmit={(event) => void addTrial(event)}>
      <div><p className="eyebrow">MANUAL TRIAL</p><h2>仮メンバーを手動追加</h2></div>
      <label>試算上の名前<input name="name" required maxLength={80} placeholder={`仮メンバー${data.simulationMembers.length + 1}`} /></label>
      <label>コース<select name="course">{COURSES.map((course) => <option key={course}>{course}</option>)}</select></label>
      <label>配置先<select name="parent">{snapshot?.members.filter((member) => member.endedPeriod === null).map((member) => <option key={member.id} value={member.id}>{trialIds.has(member.id) ? "【仮】" : ""}{member.displayName}</option>)}</select></label>
      <button className="secondary-button" disabled={busy}>{busy ? "反映中…" : "試算組織へ追加"}</button>
    </form>
    {message && <p className="status-message">{message}</p>}
    <div className="organization-layout">
      <section className="panel tree-panel">
        {snapshot?.members.filter((member) => member.parentMemberId === null).map((root) => <TreeNode key={root.id} member={root} snapshot={snapshot} simulationIds={trialIds} depth={0} selectedId={selected?.id ?? null} onSelect={setSelectedId} />)}
      </section>
      {selected && snapshot && <MemberDetail member={selected} snapshot={snapshot} simulation={trialIds.has(selected.id)} />}
    </div>
  </>}</PageState>;
}

function TreeNode({ member, snapshot, simulationIds, depth, selectedId, onSelect }: { member: Member; snapshot: OrganizationSnapshot; simulationIds: Set<string>; depth: number; selectedId: string | null; onSelect: (id: string) => void }) {
  const children = snapshot.members.filter((item) => item.parentMemberId === member.id);
  const pv = snapshot.purchases
    .filter((purchase) => purchase.memberId === member.id && purchase.period === snapshot.period)
    .filter((purchase) => !simulationIds.has(member.id) || purchase.kind !== "initial")
    .reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
  return <div className="tree-branch" style={{ "--depth": depth } as React.CSSProperties}>
    <button className={`member-node${selectedId === member.id ? " selected" : ""}${simulationIds.has(member.id) ? " simulation" : ""}`} onClick={() => onSelect(member.id)}>
      <span className={`course course-${member.course}`}>{member.course}</span><span><strong>{member.displayName}{simulationIds.has(member.id) && <em className="trial-tag">仮</em>}</strong><small>{number.format(pv)} p.v. · {member.title}</small></span>
    </button>
    {children.length > 0 && <div className="tree-children">{children.map((child) => <TreeNode key={child.id} member={child} snapshot={snapshot} simulationIds={simulationIds} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}</div>}
  </div>;
}

function MemberDetail({ member, snapshot, simulation = false }: { member: Member; snapshot: OrganizationSnapshot; simulation?: boolean }) {
  const purchases = snapshot.purchases.filter((purchase) => purchase.memberId === member.id).slice(-5).reverse();
  return <aside className={`panel member-detail${simulation ? " simulation-detail" : ""}`}><p className="eyebrow">{simulation ? "TRIAL MEMBER" : "MEMBER DETAIL"}</p><h2>{member.displayName}{simulation && <em className="trial-tag">仮</em>}</h2>
    {simulation && <p className="trial-note">試算中だけ存在する仮メンバーです。初回・リピート相当を各1件として計算し、公式登録・実組織には反映されません。</p>}
    <dl><div><dt>コース</dt><dd>{member.course}</dd></div><div><dt>タイトル</dt><dd>{member.title}</dd></div><div><dt>ID種別</dt><dd>{member.idKind === "master" ? "マスター" : "サブ"}</dd></div><div><dt>トレーナー</dt><dd>{member.trainerCredential}</dd></div></dl>
    <h3>購入履歴</h3>{purchases.length ? purchases.map((purchase) => <div className="history-row" key={purchase.id}><span>{purchase.period} · {purchase.kind}</span><strong>{number.format(purchase.pv)} p.v.</strong></div>) : <p className="muted">履歴はありません</p>}
  </aside>;
}

function Products() {
  const { data, error, loading } = useLoad(api.products, []);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const totals = useMemo(() => data?.products.reduce((sum, product) => { const quantity = selected[product.code] ?? 0; return { price: sum.price + product.price * quantity, pv: sum.pv + product.pv * quantity, conversion: sum.conversion + product.conversion * quantity }; }, { price: 0, pv: 0, conversion: 0 }) ?? { price: 0, pv: 0, conversion: 0 }, [data, selected]);
  return <PageState loading={loading} error={error}>{data && <><PageHeading kicker="PRODUCT MASTER" title="商品とp.v." description={`設定版 ${data.planVersion}`} />
    <section className="calculator-bar"><div><small>選択合計</small><strong>{yen.format(totals.price)}</strong></div><div><small>p.v.</small><strong>{number.format(totals.pv)}</strong></div><div><small>換算数</small><strong>{totals.conversion}</strong></div></section>
    <div className="product-grid">{data.products.map((product) => <article className="product-card" key={product.code}><span className="product-category">{product.category}</span><h3>{product.name}</h3><p>{yen.format(product.price)} · {number.format(product.pv)} p.v. · {product.conversion}品換算</p><div className="stepper"><button onClick={() => setSelected((current) => ({ ...current, [product.code]: Math.max(0, (current[product.code] ?? 0) - 1) }))}>−</button><strong>{selected[product.code] ?? 0}</strong><button onClick={() => setSelected((current) => ({ ...current, [product.code]: (current[product.code] ?? 0) + 1 }))}>＋</button></div></article>)}</div>
  </>}</PageState>;
}

function Simulator() {
  const tree = useLoad(api.simulationOrganization, []); const tax = useLoad(api.tax, []); const goal = useLoad(api.goal, []);
  const [results, setResults] = useState<PlacementResult[]>([]); const [busy, setBusy] = useState(false); const [savingId, setSavingId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ name: string; course: CourseCode } | null>(null);
  const snapshot = tree.data?.snapshot ?? null;
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!tax.data || !goal.data || !snapshot) return; setBusy(true); setError(null); setMessage(null); const values = new FormData(event.currentTarget); const nextCandidate = { name: String(values.get("name")), course: String(values.get("course")) as CourseCode }; try { const response = await api.simulate({ candidateName: nextCandidate.name, course: nextCandidate.course, period: snapshot.period, targetTitle: goal.data.targetTitle, taxProfile: tax.data }); setCandidate(nextCandidate); setResults(response.results); } catch (reason) { setError(reason instanceof Error ? reason.message : "計算できませんでした"); } finally { setBusy(false); } };
  const addPlacement = async (result: PlacementResult) => { if (!candidate || !snapshot) return; setSavingId(result.placementMemberId); setError(null); try { await api.createSimulationMember({ displayName: candidate.name, course: candidate.course, parentMemberId: result.placementMemberId, period: snapshot.period }); setMessage(`${candidate.name}を${result.placementMemberName}配下の試算組織へ追加しました`); setResults([]); setCandidate(null); tree.reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "追加できませんでした"); } finally { setSavingId(null); } };
  return <PageState loading={tree.loading || tax.loading || goal.loading} error={tree.error || tax.error || goal.error}>{snapshot && <><PageHeading kicker="PLACEMENT QUEST" title="配置シミュレーター" description="仮メンバーを追加しながら、複数人を順番に当てはめられます" />
    <section className="trial-banner"><div><strong>試算中 {tree.data?.simulationMembers.length ?? 0}人</strong><small>追加済みの仮メンバーを含めて次の配置を再計算します。</small></div><NavLink to="/organization" className="text-button">組織で確認</NavLink></section>
    <form className="panel simulator-form" onSubmit={(event) => void submit(event)}><label>試算上の名前<input name="name" required placeholder={`例：仮メンバー${(tree.data?.simulationMembers.length ?? 0) + 1}`} /><small className="field-note">配置確定ボタンを押した場合だけ試算用として保存します</small></label><label>希望コース<select name="course">{COURSES.map((course) => <option key={course}>{course}</option>)}</select></label><button className="primary-button" disabled={busy}>{busy ? "全配置を計算中…" : "おすすめ配置を計算"}</button></form>{error && <div className="state-card error">{error}</div>}{message && <p className="status-message">{message}。続けて次の人を試算できます。</p>}
    <div className="results-list">{results.map((result) => <article className={`placement-card rank-${result.rank}`} key={result.placementMemberId}><div className="rank-badge">#{result.rank ?? "-"}</div><div className="placement-heading"><div><small>おすすめ配置</small><h2>{result.placementMemberName} 配下</h2></div><strong className={result.grossDelta >= 0 ? "positive" : "negative"}>{result.grossDelta >= 0 ? "+" : ""}{yen.format(result.grossDelta)}</strong></div><div className="result-stats"><span>タイトル {result.titleBefore} → {result.titleAfter}</span><span>未達 {result.missingBefore} → {result.missingAfter}</span></div><ul>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><button className="primary-button placement-save" disabled={!result.eligible || savingId !== null} onClick={() => void addPlacement(result)}>{savingId === result.placementMemberId ? "試算組織へ追加中…" : "この配置を試算組織へ追加"}</button><p className="warning">{result.warnings.join(" / ")}</p></article>)}</div>
  </>}</PageState>;
}

function Forecast() {
  const tree = useLoad(api.tree, []); const tax = useLoad(api.tax, []);
  const [horizon, setHorizon] = useState(3); const [count, setCount] = useState({ conservative: 0, standard: 1, challenge: 2 }); const [retention, setRetention] = useState({ conservative: 80, standard: 90, challenge: 100 }); const [results, setResults] = useState<ForecastResult[]>([]); const [busy, setBusy] = useState(false);
  const [course, setCourse] = useState<Record<"conservative" | "standard" | "challenge", CourseCode>>({ conservative: "A", standard: "A", challenge: "G" });
  const [placement, setPlacement] = useState({ conservative: "root", standard: "root", challenge: "root" });
  const [additionalPv, setAdditionalPv] = useState({ conservative: 0, standard: 0, challenge: 0 });
  const availableMembers = tree.data?.members.filter((member) => member.endedPeriod === null) ?? [];
  const run = async () => { if (!tree.data || !tax.data) return; const root = tree.data.members.find((member) => member.parentMemberId === null); if (!root) return; const ids = ["conservative", "standard", "challenge"] as const; const scenarios: ForecastScenario[] = ids.map((id) => ({ id, label: id === "conservative" ? "保守" : id === "standard" ? "標準" : "挑戦", taxProfile: tax.data ?? DEFAULT_TAX, months: Array.from({ length: horizon }, (_, index) => { const [year, month] = tree.data!.period.split("-").map(Number); const date = new Date(Date.UTC(year!, month! - 1 + index + 1, 1)); const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,"0")}`; return { period, registrations: [{ course: course[id], placementMemberId: placement[id], count: count[id] }], continuationRate: retention[id] / 100, additionalPv: additionalPv[id] }; }) })); setBusy(true); try { setResults((await api.forecast({ period: tree.data.period, rootMemberId: root.id, scenarios })).results); } finally { setBusy(false); } };
  return <PageState loading={tree.loading || tax.loading} error={tree.error || tax.error}>{tree.data && <><PageHeading kicker="FUTURE MAP" title="条件付き将来予測" description="入力した前提が実現した場合の試算です" />
    <section className="panel forecast-controls"><div className="segment">{[[3,"3か月"],[6,"6か月"],[12,"1年"]].map(([value,label]) => <button key={value} className={horizon === value ? "active" : ""} onClick={() => setHorizon(Number(value))}>{label}</button>)}</div><p className="input-note">各シナリオの毎月共通前提を明示します。</p><div className="scenario-inputs">{(["conservative","standard","challenge"] as const).map((id) => <div key={id}><h3>{id === "conservative" ? "保守" : id === "standard" ? "標準" : "挑戦"}</h3><label>毎月の新規人数<input type="number" min="0" max="50" value={count[id]} onChange={(event) => setCount((current) => ({ ...current, [id]: Number(event.target.value) }))} /></label><label>継続率<input type="number" min="0" max="100" value={retention[id]} onChange={(event) => setRetention((current) => ({ ...current, [id]: Number(event.target.value) }))} />%</label><label>コース<select value={course[id]} onChange={(event) => setCourse((current) => ({ ...current, [id]: event.target.value as CourseCode }))}>{COURSES.map((item) => <option key={item}>{item}</option>)}</select></label><label>配置先<select value={placement[id]} onChange={(event) => setPlacement((current) => ({ ...current, [id]: event.target.value }))}>{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label className="wide-input">毎月の本人追加p.v.<input type="number" min="0" value={additionalPv[id]} onChange={(event) => setAdditionalPv((current) => ({ ...current, [id]: Number(event.target.value) }))} /></label></div>)}</div><button className="primary-button" onClick={() => void run()} disabled={busy}>{busy ? "計算中…" : "3シナリオを計算"}</button></section>
    <div className="forecast-grid">{results.map((result) => <article className="panel" key={result.scenarioId}><h2>{result.scenarioId === "conservative" ? "保守" : result.scenarioId === "standard" ? "標準" : "挑戦"}</h2>{result.months.map((month) => <div className="forecast-row" key={month.period}><div><strong>{month.period}</strong><small>{month.title} · {month.groupMembers}人</small></div><div><strong>{number.format(month.groupPv)} p.v.</strong><small>{yen.format(month.gross)}</small></div></div>)}</article>)}</div><p className="disclaimer">将来の登録・継続・報酬を保証するものではありません。入力した仮定を明記した条件付き試算です。</p>
  </>}</PageState>;
}

function Imports() {
  const [kind, setKind] = useState<"members" | "purchases">("members"); const [csv, setCsv] = useState(""); const [preview, setPreview] = useState<{ headers: string[]; rows: Array<Record<string,string>>; errors: Array<{row:number;field:string;message:string}> } | null>(null); const [message, setMessage] = useState<string | null>(null);
  const loadFile = (file: File | undefined) => { if (!file) return; if (file.size > 1_000_000) { setMessage("CSVは1MB以下にしてください"); return; } void file.text().then(setCsv); };
  const runPreview = async () => { setMessage(null); try { setPreview(await api.previewImport(kind, csv)); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "確認できませんでした"); } };
  const commit = async () => { try { const result = await api.commitImport(kind, csv); setMessage(`${result.imported}件を取り込みました`); setPreview(null); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "取り込めませんでした"); } };
  return <><PageHeading kicker="CSV IMPORT" title="一括取り込み" description="プレビューで全行を検証してから一括反映します" /><section className="panel import-panel"><label>データ種別<select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPreview(null); }}><option value="members">会員</option><option value="purchases">月次購入</option></select></label><a className="secondary-button link-button" href={`/api/v1/imports/template/${kind}`}>テンプレート取得</a><label className="file-drop">CSVを選択<input type="file" accept=".csv,text/csv" onChange={(event) => loadFile(event.target.files?.[0])} /><small>最大1MB・UTF-8</small></label><button className="primary-button" onClick={() => void runPreview()} disabled={!csv}>内容を確認</button>{message && <p className="status-message">{message}</p>}</section>{preview && <section className="panel"><div className="panel-title"><h2>{preview.rows.length}件のプレビュー</h2><span className={preview.errors.length ? "status-chip danger" : "status-chip"}>{preview.errors.length ? `${preview.errors.length}件エラー` : "反映可能"}</span></div>{preview.errors.map((issue) => <p className="form-error" key={`${issue.row}-${issue.field}`}>{issue.row}行目 {issue.field}: {issue.message}</p>)}<div className="table-scroll"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.slice(0,20).map((row,index) => <tr key={index}>{preview.headers.map((header) => <td key={header}>{row[header]}</td>)}</tr>)}</tbody></table></div><button className="primary-button" disabled={preview.errors.length > 0} onClick={() => void commit()}>全件を一括反映</button></section>}</>;
}

function Settings() {
  const taxLoad = useLoad(api.tax, []); const goalLoad = useLoad(api.goal, []); const [saved, setSaved] = useState(false);
  const [tax, setTax] = useState<TaxProfile | null>(null); const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => { if (taxLoad.data) setTax(taxLoad.data); }, [taxLoad.data]); useEffect(() => { if (goalLoad.data) setGoal(goalLoad.data); }, [goalLoad.data]);
  const save = async () => { if (!tax || !goal) return; await Promise.all([api.saveTax(tax), api.saveGoal(goal)]); setSaved(true); window.setTimeout(() => setSaved(false), 2500); };
  return <PageState loading={taxLoad.loading || goalLoad.loading} error={taxLoad.error || goalLoad.error}>{tax && goal && <><PageHeading kicker="SETTINGS" title="目標と概算条件" description="概算手取の条件は公式明細と分けて管理します" /><section className="panel form-grid"><label>目標タイトル<select value={goal.targetTitle} onChange={(event) => setGoal({ ...goal, targetTitle: event.target.value as TitleCode })}>{TITLE_ORDER.filter((title) => title !== "NONE").map((title) => <option key={title}>{title}</option>)}</select></label><label>目標営業月<input type="month" value={goal.targetPeriod} onChange={(event) => setGoal({ ...goal, targetPeriod: event.target.value })} /></label><label className="check-label span-2"><input type="checkbox" checked={tax.invoiceRegistered} onChange={(event) => setTax({ ...tax, invoiceRegistered: event.target.checked })} />適格請求書発行事業者として登録済み</label><label>源泉徴収率<input type="number" min="0" max="100" step="0.01" value={tax.withholdingRate * 100} onChange={(event) => setTax({ ...tax, withholdingRate: Number(event.target.value) / 100 })} />%</label><label>振込手数料<input type="number" min="0" value={tax.transferFee} onChange={(event) => setTax({ ...tax, transferFee: Number(event.target.value) })} /></label><label>相殺額<input type="number" min="0" value={tax.offsets} onChange={(event) => setTax({ ...tax, offsets: Number(event.target.value) })} /></label><label>前月繰越<input type="number" min="0" value={tax.priorCarryover} onChange={(event) => setTax({ ...tax, priorCarryover: Number(event.target.value) })} /></label><div className="form-actions span-2"><button className="primary-button" onClick={() => void save()}>{saved ? "保存しました" : "設定を保存"}</button></div></section><p className="disclaimer">源泉徴収、インボイス経過措置、相殺、手数料を用いた概算です。税務判断には使用せず、公式支払明細と専門家の確認を優先してください。</p></>}</PageState>;
}

function conditionValue(value: number | boolean | string) {
  if (typeof value === "boolean") return value ? "達成" : "未達";
  return typeof value === "number" ? number.format(value) : value;
}

function conditionShortage(condition: TitleChecklistItem["conditions"][number]) {
  if (condition.met) return "達成";
  if (typeof condition.current === "number" && typeof condition.required === "number") {
    return `あと ${number.format(Math.max(0, condition.required - condition.current))}`;
  }
  return "未達";
}

function TitleConditions({ conditions }: { conditions: TitleChecklistItem["conditions"] }) {
  return <div className="title-condition-list">{conditions.map((condition) => <div className={condition.met ? "title-condition met" : "title-condition"} key={condition.key}><span>{condition.met ? "✓" : "!"}</span><div><strong>{condition.label}</strong><small>現在 {conditionValue(condition.current)} / 必要 {conditionValue(condition.required)}</small></div><em>{conditionShortage(condition)}</em></div>)}</div>;
}

function TitleReference() {
  const { data, error, loading } = useLoad(api.titleChecklists, []);
  return <PageState loading={loading} error={error}>{data && <>
    <PageHeading kicker="REFERENCE" title="全タイトル条件" description="現在の組織と実績で、各タイトルまでの不足を確認します" />
    <section className="panel title-reference-summary"><div><small>現在タイトル</small><strong>{data.achievedTitle === "NONE" ? "未取得" : data.achievedTitle}</strong></div><div><small>対象営業月</small><strong>{data.period}</strong></div><div><small>ルール設定版</small><strong>{data.planVersion}</strong></div></section>
    <div className="title-checklist">{data.titles.map((title) => <details className={`title-reference-card ${title.status}`} key={title.code} open={title.status === "next"}><summary><span className="title-code">{title.code}</span><div><strong>{title.label}</strong><small>{title.conditions.filter((condition) => !condition.met).length}件の未達条件</small></div><div className="title-progress"><strong>{title.progress}%</strong><span>{title.status === "achieved" ? "達成圏" : title.status === "next" ? "次の目標" : "参考"}</span></div></summary><div className="title-reference-body"><TitleConditions conditions={title.conditions} />{title.alternatives && <section className="alternative-section"><h3>いずれかの取得パターンを達成</h3><div className="alternative-grid">{title.alternatives.map((alternative) => <div className={alternative.met ? "alternative-card met" : "alternative-card"} key={alternative.label}><div className="alternative-heading"><strong>{alternative.label}</strong><span>{alternative.met ? "達成" : "未達"}</span></div><TitleConditions conditions={alternative.conditions} /></div>)}</div></section>}</div></details>)}</div>
    <section className="panel source-panel"><h2>設定データの出典</h2>{data.sources.map((source) => <p key={`${source.name}-${source.revision}`}><strong>{source.name}</strong><span>{source.revision}・{source.pages}</span></p>)}</section>
    <p className="disclaimer">参考表示です。取得・維持の正式判定は最新の公式資料とフォーデイズ公式画面を優先してください。</p>
  </>}</PageState>;
}

function More() { return <><PageHeading kicker="TOOLS" title="その他" description="試算に使う設定とマスタ" /><div className="menu-grid"><NavLink to="/products"><span>▦</span><strong>商品マスタ</strong><small>価格・p.v.自動計算</small></NavLink><NavLink to="/imports"><span>⇩</span><strong>CSV取り込み</strong><small>会員・月次購入</small></NavLink><NavLink to="/settings"><span>⚙</span><strong>設定</strong><small>目標・概算条件</small></NavLink></div><section className="panel reference-tools"><p className="eyebrow">REFERENCE</p><h2>参考機能</h2><NavLink to="/reference/titles"><span>一覧</span><div><strong>全タイトル条件</strong><small>各タイトルの条件表と現在の不足を確認</small></div><b>›</b></NavLink></section><section className="panel about-card"><h2>このアプリについて</h2><p>組織、タイトル、報酬、配置、将来条件の試算を行う、非公式の個人用シミュレーターです。公式サイトへの自動ログイン、登録、購入は行いません。</p><p>人物・関係性・フォローの管理は「つながりカルテ」で行い、Navigatorには保存しません。将来連携する場合も、試算に必要な最小限のデータだけを受け取ります。</p></section></>; }

function PageHeading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>; }

export default function App() { return <Layout />; }
