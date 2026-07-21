import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api";
import {
  COURSES,
  TITLE_ORDER,
  type ActivityEvent,
  type CourseCode,
  type ForecastResult,
  type ForecastScenario,
  type Goal,
  type Member,
  type OrganizationSnapshot,
  type PlacementResult,
  type Prospect,
  type TaxProfile,
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
  ["/", "⌂", "ホーム"], ["/organization", "⌘", "組織"], ["/prospects", "◎", "ABC"],
  ["/simulator", "◇", "配置"], ["/forecast", "↗", "予測"], ["/more", "•••", "その他"]
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
          <Route path="/prospects" element={<Prospects />} />
          <Route path="/products" element={<Products />} />
          <Route path="/simulator" element={<Simulator />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/imports" element={<Imports />} />
          <Route path="/settings" element={<Settings />} />
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
        <section className="panel mission-panel">
          <div className="panel-title"><div><p className="eyebrow">TODAY'S MISSION</p><h2>今日やること</h2></div><span className="star-count">★★★★★</span></div>
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
  const { data, error, loading } = useLoad(api.tree, []);
  const activities = useLoad(api.activities, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.members.find((member) => member.id === selectedId) ?? data?.members[0] ?? null;
  return <PageState loading={loading || activities.loading} error={error || activities.error}>{data && <>
    <PageHeading kicker="ORGANIZATION" title="組織ツリー" description="配置・紹介・サブIDを分けて管理します" />
    <div className="organization-layout">
      <section className="panel tree-panel">
        {data.members.filter((member) => member.parentMemberId === null).map((root) => <TreeNode key={root.id} member={root} snapshot={data} depth={0} selectedId={selected?.id ?? null} onSelect={setSelectedId} />)}
      </section>
      {selected && <MemberDetail member={selected} snapshot={data} activities={activities.data ?? []} />}
    </div>
  </>}</PageState>;
}

function TreeNode({ member, snapshot, depth, selectedId, onSelect }: { member: Member; snapshot: OrganizationSnapshot; depth: number; selectedId: string | null; onSelect: (id: string) => void }) {
  const children = snapshot.members.filter((item) => item.parentMemberId === member.id);
  const pv = snapshot.purchases.filter((purchase) => purchase.memberId === member.id && purchase.period === snapshot.period).reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
  return <div className="tree-branch" style={{ "--depth": depth } as React.CSSProperties}>
    <button className={selectedId === member.id ? "member-node selected" : "member-node"} onClick={() => onSelect(member.id)}>
      <span className={`course course-${member.course}`}>{member.course}</span><span><strong>{member.displayName}</strong><small>{number.format(pv)} p.v. · {member.title}</small></span>
    </button>
    {children.length > 0 && <div className="tree-children">{children.map((child) => <TreeNode key={child.id} member={child} snapshot={snapshot} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}</div>}
  </div>;
}

function MemberDetail({ member, snapshot, activities }: { member: Member; snapshot: OrganizationSnapshot; activities: ActivityEvent[] }) {
  const purchases = snapshot.purchases.filter((purchase) => purchase.memberId === member.id).slice(-5).reverse();
  const memberActivities = activities.filter((activity) => activity.memberId === member.id).slice(0, 5);
  return <aside className="panel member-detail"><p className="eyebrow">MEMBER DETAIL</p><h2>{member.displayName}</h2>
    <dl><div><dt>コース</dt><dd>{member.course}</dd></div><div><dt>タイトル</dt><dd>{member.title}</dd></div><div><dt>ID種別</dt><dd>{member.idKind === "master" ? "マスター" : "サブ"}</dd></div><div><dt>トレーナー</dt><dd>{member.trainerCredential}</dd></div></dl>
    <h3>購入履歴</h3>{purchases.length ? purchases.map((purchase) => <div className="history-row" key={purchase.id}><span>{purchase.period} · {purchase.kind}</span><strong>{number.format(purchase.pv)} p.v.</strong></div>) : <p className="muted">履歴はありません</p>}
    <h3>活動履歴</h3>{memberActivities.length ? memberActivities.map((activity) => <div className="history-row" key={activity.id}><span>{activity.occurredAt.slice(0, 10)} · {activity.activityType}</span><strong>{activity.note || "記録"}</strong></div>) : <p className="muted">履歴はありません</p>}
  </aside>;
}

function Prospects() {
  const { data, error, loading, reload } = useLoad(api.prospects, []);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError(null);
    const values = new FormData(event.currentTarget);
    try {
      await api.createProspect({ name: String(values.get("name")), ageBand: String(values.get("ageBand")), introducerMemberId: "root", temperature: Number(values.get("temperature")) as Prospect["temperature"], interestTags: values.getAll("interestTags").map(String), firstContactDate: String(values.get("firstContactDate")) || null, productExperience: values.get("productExperience") === "on", briefingAttended: false, registrationStatus: "lead", nextActionDate: String(values.get("nextActionDate")) || null, notes: String(values.get("notes")) });
      setShowForm(false); reload();
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "登録できませんでした"); }
  };
  return <PageState loading={loading} error={error}>{data && <>
    <PageHeading kicker="ABC CHART" title="候補者カルテ" description="病歴や服薬は保存せず、関心タグで管理します" action={<button className="primary-button" onClick={() => setShowForm((value) => !value)}>＋ 候補者</button>} />
    {showForm && <form className="panel form-grid" onSubmit={(event) => void submit(event)}>
      <label>名前<input name="name" required maxLength={80} /></label><label>年代<select name="ageBand"><option>20代</option><option>30代</option><option>40代</option><option>50代</option><option>60代以上</option></select></label>
      <label>温度感<select name="temperature" defaultValue="3">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{"★".repeat(value)}</option>)}</select></label><label>初回接触日<input name="firstContactDate" type="date" /></label><label>次回予定日<input name="nextActionDate" type="date" /></label>
      <fieldset><legend>関心タグ</legend>{["美容","食生活","健康維持","運動","家族"].map((tag) => <label className="check-label" key={tag}><input type="checkbox" name="interestTags" value={tag} />{tag}</label>)}</fieldset>
      <label className="check-label"><input type="checkbox" name="productExperience" />商品体験済み</label><label className="span-2">メモ<textarea name="notes" maxLength={1000} placeholder="病名・診療・服薬などは記録しないでください" /></label>
      {formError && <p className="form-error span-2">{formError}</p>}<div className="form-actions span-2"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>キャンセル</button><button className="primary-button">保存</button></div>
    </form>}
    <div className="card-list">{data.map((prospect) => <article className="prospect-card" key={prospect.id}><div className="avatar">{prospect.name.slice(0,1)}</div><div className="prospect-main"><div><h3>{prospect.name}</h3><span className={`temperature t-${prospect.temperature}`}>{"★".repeat(prospect.temperature)}</span></div><p>{prospect.ageBand} · {prospect.interestTags.join(" / ") || "関心未設定"}</p><div className="tag-row"><span>{prospect.productExperience ? "体験済" : "未体験"}</span><span>{prospect.briefingAttended ? "説明会済" : "説明会前"}</span><span>{prospect.registrationStatus}</span></div></div><div className="next-date"><small>次回</small><strong>{prospect.nextActionDate ?? "未定"}</strong></div></article>)}</div>
  </>}</PageState>;
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
  const tree = useLoad(api.tree, []); const tax = useLoad(api.tax, []); const goal = useLoad(api.goal, []);
  const [results, setResults] = useState<PlacementResult[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!tax.data || !goal.data || !tree.data) return; setBusy(true); setError(null); const values = new FormData(event.currentTarget); try { const response = await api.simulate({ candidateName: String(values.get("name")), course: String(values.get("course")) as CourseCode, period: tree.data.period, targetTitle: goal.data.targetTitle, taxProfile: tax.data }); setResults(response.results); } catch (reason) { setError(reason instanceof Error ? reason.message : "計算できませんでした"); } finally { setBusy(false); } };
  return <PageState loading={tree.loading || tax.loading || goal.loading} error={tree.error || tax.error || goal.error}>{tree.data && <><PageHeading kicker="PLACEMENT QUEST" title="配置シミュレーター" description="公式登録は変更しません。上位3案を比較します" />
    <form className="panel simulator-form" onSubmit={(event) => void submit(event)}><label>候補者名<input name="name" required placeholder="候補者" /></label><label>希望コース<select name="course">{COURSES.map((course) => <option key={course}>{course}</option>)}</select></label><button className="primary-button" disabled={busy}>{busy ? "全配置を計算中…" : "おすすめ配置を計算"}</button></form>{error && <div className="state-card error">{error}</div>}
    <div className="results-list">{results.map((result) => <article className={`placement-card rank-${result.rank}`} key={result.placementMemberId}><div className="rank-badge">#{result.rank ?? "-"}</div><div className="placement-heading"><div><small>おすすめ配置</small><h2>{result.placementMemberName} 配下</h2></div><strong className={result.grossDelta >= 0 ? "positive" : "negative"}>{result.grossDelta >= 0 ? "+" : ""}{yen.format(result.grossDelta)}</strong></div><div className="result-stats"><span>タイトル {result.titleBefore} → {result.titleAfter}</span><span>未達 {result.missingBefore} → {result.missingAfter}</span></div><ul>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p className="warning">{result.warnings.join(" / ")}</p></article>)}</div>
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
  const [kind, setKind] = useState<"members" | "purchases" | "prospects">("members"); const [csv, setCsv] = useState(""); const [preview, setPreview] = useState<{ headers: string[]; rows: Array<Record<string,string>>; errors: Array<{row:number;field:string;message:string}> } | null>(null); const [message, setMessage] = useState<string | null>(null);
  const loadFile = (file: File | undefined) => { if (!file) return; if (file.size > 1_000_000) { setMessage("CSVは1MB以下にしてください"); return; } void file.text().then(setCsv); };
  const runPreview = async () => { setMessage(null); try { setPreview(await api.previewImport(kind, csv)); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "確認できませんでした"); } };
  const commit = async () => { try { const result = await api.commitImport(kind, csv); setMessage(`${result.imported}件を取り込みました`); setPreview(null); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "取り込めませんでした"); } };
  return <><PageHeading kicker="CSV IMPORT" title="一括取り込み" description="プレビューで全行を検証してから一括反映します" /><section className="panel import-panel"><label>データ種別<select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPreview(null); }}><option value="members">会員</option><option value="purchases">月次購入</option><option value="prospects">候補者</option></select></label><a className="secondary-button link-button" href={`/api/v1/imports/template/${kind}`}>テンプレート取得</a><label className="file-drop">CSVを選択<input type="file" accept=".csv,text/csv" onChange={(event) => loadFile(event.target.files?.[0])} /><small>最大1MB・UTF-8</small></label><button className="primary-button" onClick={() => void runPreview()} disabled={!csv}>内容を確認</button>{message && <p className="status-message">{message}</p>}</section>{preview && <section className="panel"><div className="panel-title"><h2>{preview.rows.length}件のプレビュー</h2><span className={preview.errors.length ? "status-chip danger" : "status-chip"}>{preview.errors.length ? `${preview.errors.length}件エラー` : "反映可能"}</span></div>{preview.errors.map((issue) => <p className="form-error" key={`${issue.row}-${issue.field}`}>{issue.row}行目 {issue.field}: {issue.message}</p>)}<div className="table-scroll"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.slice(0,20).map((row,index) => <tr key={index}>{preview.headers.map((header) => <td key={header}>{row[header]}</td>)}</tr>)}</tbody></table></div><button className="primary-button" disabled={preview.errors.length > 0} onClick={() => void commit()}>全件を一括反映</button></section>}</>;
}

function Settings() {
  const taxLoad = useLoad(api.tax, []); const goalLoad = useLoad(api.goal, []); const [saved, setSaved] = useState(false);
  const [tax, setTax] = useState<TaxProfile | null>(null); const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => { if (taxLoad.data) setTax(taxLoad.data); }, [taxLoad.data]); useEffect(() => { if (goalLoad.data) setGoal(goalLoad.data); }, [goalLoad.data]);
  const save = async () => { if (!tax || !goal) return; await Promise.all([api.saveTax(tax), api.saveGoal(goal)]); setSaved(true); window.setTimeout(() => setSaved(false), 2500); };
  return <PageState loading={taxLoad.loading || goalLoad.loading} error={taxLoad.error || goalLoad.error}>{tax && goal && <><PageHeading kicker="SETTINGS" title="目標と概算条件" description="概算手取の条件は公式明細と分けて管理します" /><section className="panel form-grid"><label>目標タイトル<select value={goal.targetTitle} onChange={(event) => setGoal({ ...goal, targetTitle: event.target.value as TitleCode })}>{TITLE_ORDER.filter((title) => title !== "NONE").map((title) => <option key={title}>{title}</option>)}</select></label><label>目標営業月<input type="month" value={goal.targetPeriod} onChange={(event) => setGoal({ ...goal, targetPeriod: event.target.value })} /></label><label className="check-label span-2"><input type="checkbox" checked={tax.invoiceRegistered} onChange={(event) => setTax({ ...tax, invoiceRegistered: event.target.checked })} />適格請求書発行事業者として登録済み</label><label>源泉徴収率<input type="number" min="0" max="100" step="0.01" value={tax.withholdingRate * 100} onChange={(event) => setTax({ ...tax, withholdingRate: Number(event.target.value) / 100 })} />%</label><label>振込手数料<input type="number" min="0" value={tax.transferFee} onChange={(event) => setTax({ ...tax, transferFee: Number(event.target.value) })} /></label><label>相殺額<input type="number" min="0" value={tax.offsets} onChange={(event) => setTax({ ...tax, offsets: Number(event.target.value) })} /></label><label>前月繰越<input type="number" min="0" value={tax.priorCarryover} onChange={(event) => setTax({ ...tax, priorCarryover: Number(event.target.value) })} /></label><div className="form-actions span-2"><button className="primary-button" onClick={() => void save()}>{saved ? "保存しました" : "設定を保存"}</button></div></section><p className="disclaimer">源泉徴収、インボイス経過措置、相殺、手数料を用いた概算です。税務判断には使用せず、公式支払明細と専門家の確認を優先してください。</p></>}</PageState>;
}

function More() { return <><PageHeading kicker="TOOLS" title="その他" description="管理とマスタ機能" /><div className="menu-grid"><NavLink to="/products"><span>▦</span><strong>商品マスタ</strong><small>価格・p.v.自動計算</small></NavLink><NavLink to="/imports"><span>⇩</span><strong>CSV取り込み</strong><small>会員・購入・候補者</small></NavLink><NavLink to="/settings"><span>⚙</span><strong>設定</strong><small>目標・概算条件</small></NavLink></div><section className="panel about-card"><h2>このアプリについて</h2><p>公式資料を設定データとして扱う、非公式の個人用攻略シミュレーターです。公式サイトへの自動ログイン、登録、購入は行いません。</p><p>病歴・診療・服薬などの要配慮個人情報、口座、実会員IDは保存しないでください。</p></section></>; }

function PageHeading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>; }

export default function App() { return <Layout />; }
