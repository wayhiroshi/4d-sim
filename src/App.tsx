import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api";
import {
  COURSES,
  TITLE_ORDER,
  type BatchSimulationResult,
  type CourseCode,
  type ForecastResult,
  type ForecastScenario,
  type Goal,
  type IdKind,
  type Member,
  type OrganizationSnapshot,
  type PlacementResult,
  type SavedForecast,
  type SimulationOrganization,
  type TaxProfile,
  type TrainerBonusRole,
  type TrainerCredential,
  type TrainerQualificationChecklistItem,
  type TrainerQualificationProfile,
  type TitleChecklistItem,
  type TitleCode
} from "./shared/types";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ja-JP");
const DEFAULT_TAX: TaxProfile = { invoiceRegistered: false, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 };
const TRAINER_ROLE_OPTIONS: Array<{ value: "" | TrainerBonusRole; label: string }> = [
  { value: "", label: "担当しない・別の方が担当" },
  { value: "PT", label: "自分がPトレーナーとして担当" },
  { value: "ST_SOLO", label: "自分がSトレーナーとして単独担当" },
  { value: "ST_WITH_PT", label: "自分がSトレーナーとしてPトレと同時担当" }
];
const trainerRoleAvailable = (credential: TrainerCredential, role: "" | TrainerBonusRole): boolean => {
  if (role === "") return true;
  if (role === "PT") return credential !== "NONE";
  return credential === "ST";
};
type ForecastScenarioId = ForecastScenario["id"];
type ForecastSetting = {
  direct: number; retention: number; course: CourseCode; placement: string; additionalPv: number;
  trainerBonusRole: TrainerBonusRole | null;
  teamActivity: number; introductionsPerActiveMember: number; maxTeamRegistrations: number;
};
const FORECAST_IDS: ForecastScenarioId[] = ["conservative", "standard", "challenge"];
const FORECAST_LABELS: Record<ForecastScenarioId, string> = { conservative: "想定より悪い", standard: "現実ライン", challenge: "目標ライン" };
const DEFAULT_FORECAST_SETTINGS: Record<ForecastScenarioId, ForecastSetting> = {
  conservative: { direct: 0, retention: 75, course: "A", placement: "root", additionalPv: 0, trainerBonusRole: null, teamActivity: 0, introductionsPerActiveMember: 0, maxTeamRegistrations: 0 },
  standard: { direct: 1, retention: 85, course: "A", placement: "root", additionalPv: 0, trainerBonusRole: null, teamActivity: 10, introductionsPerActiveMember: 0.5, maxTeamRegistrations: 5 },
  challenge: { direct: 2, retention: 95, course: "G", placement: "root", additionalPv: 0, trainerBonusRole: null, teamActivity: 25, introductionsPerActiveMember: 1, maxTeamRegistrations: 15 }
};

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
          <Metric label={data.ownedIdCount > 1 ? `総ボーナス（計${data.ownedIdCount}ID）` : "総ボーナス"} value={yen.format(data.bonus.gross)} />
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
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [manualIdKind, setManualIdKind] = useState<IdKind>("master");
  const [trialIdKind, setTrialIdKind] = useState<IdKind>("master");
  const snapshot = data?.snapshot ?? null;
  const trialIds = useMemo(() => new Set(data?.simulationMembers.map((member) => member.id) ?? []), [data]);
  const actualMembers = snapshot?.members.filter((member) => !trialIds.has(member.id) && member.endedPeriod === null) ?? [];
  const rootMember = actualMembers.find((member) => member.parentMemberId === null) ?? actualMembers[0] ?? null;
  const selected = snapshot?.members.find((member) => member.id === selectedId) ?? snapshot?.members[0] ?? null;
  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!snapshot || !rootMember) return;
    const form = event.currentTarget; const values = new FormData(form); setBusy(true); setMessage(null);
    try {
      const member = await api.createMember({
        displayName: String(values.get("name")), parentMemberId: String(values.get("parent")),
        introducerMemberId: manualIdKind === "sub" ? rootMember.id : String(values.get("introducer")),
        masterMemberId: manualIdKind === "sub" ? rootMember.id : null, trainerMemberId: null,
        idKind: manualIdKind, course: String(values.get("course")) as CourseCode, title: "NONE",
        trainerCredential: "NONE", sponsorLicense: false,
        openStudioAttendances: 0, preTrainerCourseCompleted: false, preTrainerKitPurchased: false,
        startTrainerCourseCompleted: false, startTrainerKitPurchased: false, directorPromotedPeriod: null,
        joinedPeriod: snapshot.period, endedPeriod: null
      });
      form.reset(); setManualIdKind("master"); setSelectedId(member.id); setMessage(`${member.displayName}をNavigator内の実組織へ追加しました`); reload();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "追加できませんでした"); }
    finally { setBusy(false); }
  };
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
        period: snapshot.period,
        idKind: trialIdKind,
        trainerBonusRole: String(values.get("trainerRole")) as TrainerBonusRole || null
      });
      form.reset(); setTrialIdKind("master");
      setMessage("仮メンバーを試算中の組織へ追加しました");
      reload();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "追加できませんでした"); }
    finally { setBusy(false); }
  };
  const clearTrials = async () => {
    if (!snapshot) return;
    setBusy(true); setMessage(null);
    try { const result = await api.clearSimulationMembers(snapshot.period); setMessage(`${result.deleted}人の仮メンバーを削除しました`); setSelectedId(null); setConfirmingClear(false); reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "削除できませんでした"); }
    finally { setBusy(false); }
  };
  return <PageState loading={loading} error={error}>{data && <>
    <PageHeading kicker="ORGANIZATION" title="組織ツリー" description="公式CSVがなくても、表示名と配置を手入力して組織を作れます" />
    <form className="panel manual-member-form" onSubmit={(event) => void addMember(event)}>
      <div className="manual-member-heading"><p className="eyebrow">APP MEMBER</p><h2>実メンバーを手動追加</h2><p>公式会員IDは不要です。会員サイトのスクショを見ながら入力でき、画像自体はNavigatorへ保存しません。</p></div>
      <label>アプリ内表示名<input name="name" required maxLength={80} placeholder="例：山田さん、Aさん" /></label>
      <label>IDの扱い<select name="idKind" value={manualIdKind} onChange={(event) => setManualIdKind(event.target.value as IdKind)}><option value="master">通常の会員（マスターID）</option><option value="sub">自分のサブID</option></select><small className="field-note">サブIDは本人のマスターIDへ紐づけ、報酬を合算します</small></label>
      <label>コース<select name="course">{COURSES.map((course) => <option key={course}>{course}</option>)}</select></label>
      <label>配置先<select name="parent" defaultValue={rootMember?.id}>{actualMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
      {manualIdKind === "master" && <label>紹介者<select name="introducer" defaultValue={rootMember?.id}>{actualMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}
      <button className="primary-button" disabled={busy || !rootMember}>{busy ? "追加中…" : "実組織へ追加"}</button>
      <p className="manual-member-note">この操作はNavigator内だけに保存され、フォーデイズ公式サイトの登録・配置は変更しません。</p>
    </form>
    <section className="trial-banner"><div><strong>試算中 {data.simulationMembers.length}人</strong><small>点線のカードは仮メンバーです。実際の登録データには反映されません。</small></div>{data.simulationMembers.length > 0 && <button className="text-button danger-text" disabled={busy} onClick={() => setConfirmingClear(true)}>仮メンバーを全削除</button>}</section>
    {confirmingClear && <section className="inline-confirm" role="alert"><div><strong>この営業月の仮メンバーを全員削除しますか？</strong><small>実組織には影響しません。この操作は取り消せません。</small></div><div className="inline-confirm-actions"><button className="text-button" disabled={busy} onClick={() => setConfirmingClear(false)}>キャンセル</button><button className="danger-button" disabled={busy} onClick={() => void clearTrials()}>{busy ? "削除中…" : `${data.simulationMembers.length}人を削除する`}</button></div></section>}
    {data.simulationMembers.length > 0 && <TrialBonusSummary comparison={data.bonusComparison} count={data.simulationMembers.length} />}
    <form className="panel trial-form" onSubmit={(event) => void addTrial(event)}>
      <div><p className="eyebrow">MANUAL TRIAL</p><h2>仮メンバーを手動追加</h2></div>
      <label>試算上の名前<input name="name" required maxLength={80} placeholder={`仮メンバー${data.simulationMembers.length + 1}`} /></label>
      <label>IDの扱い<select name="idKind" value={trialIdKind} onChange={(event) => setTrialIdKind(event.target.value as IdKind)}><option value="master">通常の新規会員</option><option value="sub">自分のサブID</option></select><small className="field-note">サブIDは通常5件まで。発生報酬は本人収入へ合算します</small></label>
      <label>コース<select name="course">{COURSES.map((course) => <option key={course}>{course}</option>)}</select></label>
      <label>配置先<select name="parent">{snapshot?.members.filter((member) => member.endedPeriod === null).map((member) => <option key={member.id} value={member.id}>{trialIds.has(member.id) ? "【仮】" : ""}{member.displayName}</option>)}</select></label>
      <label>Aさん役<select name="trainerRole">{TRAINER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={!trainerRoleAvailable(rootMember?.trainerCredential ?? "NONE", option.value)}>{option.label}</option>)}</select><small className="field-note">現在の登録資格：{!rootMember || rootMember.trainerCredential === "NONE" ? "未取得" : rootMember.trainerCredential}</small></label>
      <button className="secondary-button" disabled={busy}>{busy ? "反映中…" : "試算組織へ追加"}</button>
    </form>
    {message && <p className="status-message">{message}</p>}
    <div className="organization-layout">
      <section className="panel tree-panel">
        {snapshot?.members.filter((member) => member.parentMemberId === null).map((root) => <TreeNode key={root.id} member={root} snapshot={snapshot} simulationIds={trialIds} depth={0} selectedId={selected?.id ?? null} onSelect={setSelectedId} />)}
      </section>
      {selected && snapshot && <MemberDetail member={selected} snapshot={snapshot} simulation={trialIds.has(selected.id)} onRenamed={(displayName) => { setMessage(`表示名を「${displayName}」へ変更しました`); reload(); }} />}
    </div>
  </>}</PageState>;
}

function TrialBonusSummary({ comparison, count }: { comparison: SimulationOrganization["bonusComparison"]; count: number }) {
  const signedYen = (value: number) => `${value >= 0 ? "+" : ""}${yen.format(value)}`;
  return <section className="panel trial-bonus-summary"><div className="panel-title"><div><p className="eyebrow">TRIAL REWARD</p><h2>仮配置後の報酬試算</h2><small>本人の保有IDを{comparison.actualOwnedIdCount}ID → {comparison.simulatedOwnedIdCount}IDとして合算</small></div><span className="status-chip">仮{count}人を反映</span></div><div className="trial-bonus-metrics"><div><small>登録月の総ボーナス</small><strong>{yen.format(comparison.simulated.gross)}</strong></div><div><small>実組織との差</small><strong className={comparison.delta.gross >= 0 ? "positive" : "negative"}>{signedYen(comparison.delta.gross)}</strong></div><div><small>概算振込額</small><strong>{yen.format(comparison.simulated.estimatedNet)}</strong></div><div><small>概算振込額の差</small><strong className={comparison.delta.estimatedNet >= 0 ? "positive" : "negative"}>{signedYen(comparison.delta.estimatedNet)}</strong></div></div><BonusDeltaDetails delta={comparison.delta} /><p className="warning">仮メンバー全員の初回・定期購入相当を現在営業月へ反映した参考試算です。サブID分は本人収入へ合算します。公式登録・報酬明細は変更しません。</p></section>;
}

function TreeNode({ member, snapshot, simulationIds, depth, selectedId, onSelect }: { member: Member; snapshot: OrganizationSnapshot; simulationIds: Set<string>; depth: number; selectedId: string | null; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const children = snapshot.members.filter((item) => item.parentMemberId === member.id);
  const childrenId = `tree-children-${member.id}`;
  const pv = snapshot.purchases
    .filter((purchase) => purchase.memberId === member.id && purchase.period === snapshot.period)
    .filter((purchase) => !simulationIds.has(member.id) || purchase.kind !== "initial")
    .reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
  return <div className="tree-branch" style={{ "--depth": depth } as React.CSSProperties}>
    <button className={`member-node${selectedId === member.id ? " selected" : ""}${simulationIds.has(member.id) ? " simulation" : ""}`} aria-expanded={children.length > 0 ? expanded : undefined} aria-controls={children.length > 0 ? childrenId : undefined} onClick={() => { onSelect(member.id); if (children.length > 0) setExpanded((current) => !current); }}>
      <span className={`course course-${member.course}`}>{member.course}</span><span className="member-node-content"><strong>{member.displayName}{member.idKind === "sub" && <em className="trial-tag">サブ</em>}{simulationIds.has(member.id) && <em className="trial-tag">仮</em>}</strong><small>{number.format(pv)} p.v. · {member.title}</small></span>
      {children.length > 0 && <span className={`tree-toggle${expanded ? " expanded" : ""}`} aria-hidden="true"><small>{children.length}人</small><b>⌄</b></span>}
    </button>
    {children.length > 0 && expanded && <div className="tree-children" id={childrenId}>{children.map((child) => <TreeNode key={child.id} member={child} snapshot={snapshot} simulationIds={simulationIds} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}</div>}
  </div>;
}

function MemberDetail({ member, snapshot, simulation = false, onRenamed }: { member: Member; snapshot: OrganizationSnapshot; simulation?: boolean; onRenamed: (displayName: string) => void }) {
  const purchases = snapshot.purchases.filter((purchase) => purchase.memberId === member.id).slice(-5).reverse();
  const [editing, setEditing] = useState(false); const [displayName, setDisplayName] = useState(member.displayName); const [saving, setSaving] = useState(false); const [renameError, setRenameError] = useState<string | null>(null);
  useEffect(() => { setDisplayName(member.displayName); setEditing(false); setRenameError(null); }, [member.id, member.displayName]);
  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const nextName = displayName.trim(); if (!nextName) return; setSaving(true); setRenameError(null);
    try { if (simulation) await api.renameSimulationMember(member.id, nextName); else await api.renameMember(member.id, nextName); setEditing(false); onRenamed(nextName); }
    catch (reason) { setRenameError(reason instanceof Error ? reason.message : "変更できませんでした"); }
    finally { setSaving(false); }
  };
  return <aside className={`panel member-detail${simulation ? " simulation-detail" : ""}`}><p className="eyebrow">{simulation ? "TRIAL MEMBER" : "MEMBER DETAIL"}</p><div className="member-name-heading"><h2>{member.displayName}{simulation && <em className="trial-tag">仮</em>}</h2><button className="text-button" onClick={() => setEditing((current) => !current)}>{editing ? "閉じる" : "表示名を編集"}</button></div>
    {editing && <form className="rename-form" onSubmit={(event) => void rename(event)}><label>アプリ内表示名<input autoFocus value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="secondary-button" disabled={saving || !displayName.trim()}>{saving ? "保存中…" : "保存"}</button>{renameError && <p className="form-error">{renameError}</p>}</form>}
    {simulation && <p className="trial-note">試算中だけ存在する仮メンバーです。初回・リピート相当を各1件として計算し、公式登録・実組織には反映されません。</p>}
    <dl><div><dt>コース</dt><dd>{member.course}</dd></div><div><dt>タイトル</dt><dd>{member.title}</dd></div><div><dt>ID種別</dt><dd>{member.idKind === "master" ? "マスター" : "サブ"}</dd></div><div><dt>トレーナー</dt><dd>{member.trainerCredential}</dd></div>{simulation && <div><dt>Aさん役</dt><dd>{TRAINER_ROLE_OPTIONS.find((option) => option.value === (member.trainerBonusRole ?? ""))?.label ?? "担当なし"}</dd></div>}</dl>
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

type RewardFocus = "registration" | "line";

const lineDeltaFor = (comparison: PlacementResult["incomeComparison"]): number =>
  comparison.self.delta.line + (comparison.partner?.delta.line ?? 0);

function Simulator() {
  const tree = useLoad(api.simulationOrganization, []);
  const tax = useLoad(api.tax, []);
  const goal = useLoad(api.goal, []);
  const [results, setResults] = useState<PlacementResult[]>([]);
  const [batchResult, setBatchResult] = useState<BatchSimulationResult | null>(null);
  const [candidateCount, setCandidateCount] = useState(1);
  const [rewardFocus, setRewardFocus] = useState<RewardFocus>("registration");
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [incomeMode, setIncomeMode] = useState<"self" | "pair">("self");
  const [partnerMemberId, setPartnerMemberId] = useState("");
  const [candidate, setCandidate] = useState<{ name: string; course: CourseCode; idKind: IdKind; trainerBonusRole: TrainerBonusRole | null } | null>(null);
  const snapshot = tree.data?.snapshot ?? null;
  const rootMember = snapshot?.members.find((member) => member.parentMemberId === null) ?? null;
  const partnerOptions = snapshot?.members.filter((member) => member.id !== rootMember?.id && member.idKind === "master" && member.masterMemberId === null && (member.endedPeriod === null || member.endedPeriod > snapshot.period) && !member.id.startsWith("trial-")) ?? [];
  const selectedPartnerId = partnerMemberId || partnerOptions[0]?.id || "";
  const hasResults = batchResult !== null || results.length > 0;
  const clearResults = () => { setResults([]); setBatchResult(null); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tax.data || !goal.data || !snapshot) return;
    if (incomeMode === "pair" && !selectedPartnerId) { setError("2名合算で試算するパートナーを選択してください"); return; }
    setBusy(true); setError(null); setMessage(null);
    const values = new FormData(event.currentTarget);
    const enteredName = String(values.get("name") ?? "").trim();
    const nextCandidate = {
      name: enteredName || "試算",
      course: String(values.get("course")) as CourseCode,
      idKind: String(values.get("idKind")) as IdKind,
      trainerBonusRole: String(values.get("trainerRole")) as TrainerBonusRole || null
    };
    const request = {
      candidateName: nextCandidate.name,
      course: nextCandidate.course,
      idKind: nextCandidate.idKind,
      trainerBonusRole: nextCandidate.trainerBonusRole,
      incomeMode,
      partnerMemberId: incomeMode === "pair" ? selectedPartnerId : null,
      period: snapshot.period,
      targetTitle: goal.data.targetTitle,
      taxProfile: tax.data
    };
    try {
      setCandidate(nextCandidate);
      if (candidateCount === 1) {
        const response = await api.simulate(request);
        setResults(response.results); setBatchResult(null);
      } else {
        const response = await api.simulateBatch({ ...request, candidateCount });
        setBatchResult(response.result); setResults([]);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "計算できませんでした"); }
    finally { setBusy(false); }
  };

  const addPlacement = async (result: PlacementResult) => {
    if (!candidate || !snapshot) return;
    setSavingId(result.placementMemberId); setError(null);
    try {
      await api.createSimulationMember({ displayName: candidate.name, course: candidate.course, idKind: candidate.idKind, trainerBonusRole: candidate.trainerBonusRole, parentMemberId: result.placementMemberId, period: snapshot.period });
      setMessage(`${candidate.name}を${result.placementMemberName}配下の試算組織へ追加しました`);
      setResults([]); setCandidate(null); tree.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "追加できませんでした"); }
    finally { setSavingId(null); }
  };

  const addBatchPlacement = async () => {
    if (!candidate || !snapshot || !batchResult?.steps.length) return;
    setSavingBatch(true); setError(null);
    try {
      await api.createSimulationMembers(batchResult.steps.map((step) => ({ tempId: step.candidateMemberId, displayName: step.candidateName, parentMemberId: step.placementMemberId, course: candidate.course, period: snapshot.period, idKind: candidate.idKind, trainerBonusRole: candidate.trainerBonusRole })));
      setMessage(`${batchResult.placedCount}人を試算組織へ一括追加しました`);
      setBatchResult(null); setCandidate(null); tree.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "一括追加できませんでした"); }
    finally { setSavingBatch(false); }
  };

  return <PageState loading={tree.loading || tax.loading || goal.loading} error={tree.error || tax.error || goal.error}>{snapshot && <>
    <PageHeading kicker="PLACEMENT QUEST" title="配置シミュレーター" description="人数と条件を選び、配置後のタイトルと報酬を比較します" />
    <section className="trial-banner"><div><strong>現在の試算組織：{tree.data?.simulationMembers.length ?? 0}人</strong><small>保存済みの仮メンバーを含めて再計算します。</small></div><NavLink to="/organization" className="text-button">組織を確認</NavLink></section>

    <form className="panel simulator-workflow" onSubmit={(event) => void submit(event)}>
      <header className="simulator-workflow-heading"><div><span>1</span><div><strong>試算する人数と名前</strong><small>名前は空欄でも計算できます</small></div></div></header>
      <section className="simulator-step-grid simulator-basics">
        <div className="count-field"><span className="field-label">人数</span><div className="count-presets" role="group" aria-label="試算人数">{[1, 5, 10, 20].map((count) => <button type="button" className={candidateCount === count ? "active" : ""} aria-pressed={candidateCount === count} key={count} onClick={() => { setCandidateCount(count); clearResults(); }}>{count}人</button>)}</div><label className="custom-count">その他<input type="number" min="1" max="20" value={candidateCount} onChange={(event) => { setCandidateCount(Math.max(1, Math.min(20, Number(event.target.value) || 1))); clearResults(); }} /></label></div>
        <label>{candidateCount === 1 ? "試算上の名前（任意）" : "名前の先頭（任意）"}<input name="name" maxLength={80} placeholder={candidateCount === 1 ? "空欄なら「試算」" : "空欄なら「試算1」〜"} /><small className="field-note">{candidateCount === 1 ? "空欄時は「試算」とします" : `空欄時は「試算1」〜「試算${candidateCount}」とします`}</small></label>
      </section>

      <header className="simulator-workflow-heading"><div><span>2</span><div><strong>登録条件</strong><small>全員を同じ条件で計算します</small></div></div></header>
      <section className="simulator-step-grid simulator-conditions">
        <label>希望コース<select name="course">{COURSES.map((course) => <option key={course}>{course}</option>)}</select></label>
        <label>IDの扱い<select name="idKind" defaultValue="master"><option value="master">通常の新規会員</option><option value="sub">自分のサブID</option></select><small className="field-note">サブIDの報酬は本人へ合算</small></label>
        <label>Aさん役<select name="trainerRole">{TRAINER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={!trainerRoleAvailable(rootMember?.trainerCredential ?? "NONE", option.value)}>{option.label}</option>)}</select><small className="field-note">現在資格：{rootMember?.trainerCredential === "NONE" ? "未取得" : rootMember?.trainerCredential}</small></label>
      </section>

      <header className="simulator-workflow-heading"><div><span>3</span><div><strong>収入の集計範囲</strong><small>自分だけ、または2名合算を選びます</small></div></div></header>
      <section className="simulator-step-grid simulator-income-settings">
        <label>収入の見方<select value={incomeMode} onChange={(event) => { setIncomeMode(event.target.value as "self" | "pair"); clearResults(); }}><option value="self">自分のみ</option><option value="pair">自分＋パートナー（2名合算）</option></select></label>
        {incomeMode === "pair" && <label>合算するパートナー<select value={selectedPartnerId} disabled={!partnerOptions.length} onChange={(event) => { setPartnerMemberId(event.target.value); clearResults(); }}>{partnerOptions.length ? partnerOptions.map((member) => <option key={member.id} value={member.id}>{member.displayName}（{member.course}）</option>) : <option value="">対象メンバーがいません</option>}</select><small className="field-note">各人の報酬を個別計算して合算</small></label>}
      </section>

      <footer className="simulator-submit"><div><strong>{candidateCount === 1 ? "1人の配置候補を比較" : `${candidateCount}人を順番に効率配置`}</strong><small>計算しただけでは試算組織へ保存されません</small></div><button className="primary-button" disabled={busy || (incomeMode === "pair" && !selectedPartnerId)}>{busy ? "全配置を計算中…" : "配置を計算する"}</button></footer>
    </form>

    {error && <div className="state-card error">{error}</div>}
    {message && <p className="status-message">{message}。続けて次の人を試算できます。</p>}
    {hasResults && <section className="result-viewbar"><div><strong>結果に表示する報酬</strong><small>{rewardFocus === "registration" ? "一時ボーナスを含む登録月の差額" : "一時ボーナスを除き、ラインボーナスだけを比較"}</small></div><div className="reward-focus-switch" role="group" aria-label="報酬表示"><button type="button" className={rewardFocus === "registration" ? "active" : ""} aria-pressed={rewardFocus === "registration"} onClick={() => setRewardFocus("registration")}>登録月の総額</button><button type="button" className={rewardFocus === "line" ? "active" : ""} aria-pressed={rewardFocus === "line"} onClick={() => setRewardFocus("line")}>ラインのみ</button></div></section>}

    {batchResult && <div className="batch-results"><article className="placement-card batch-placement-card"><div className="placement-heading"><div><small>逐次最適配置の結果</small><h2>{batchResult.placedCount} / {batchResult.requestedCount}人を配置</h2></div><RewardAmount comparison={batchResult.incomeComparison} focus={rewardFocus} /></div><div className="result-stats"><span>タイトル {batchResult.titleBefore} → {batchResult.titleAfter}</span><span>未達 {batchResult.missingBefore} → {batchResult.missingAfter}</span>{batchResult.ownedIdCountAfter !== batchResult.ownedIdCountBefore && <span>本人保有 {batchResult.ownedIdCountBefore} → {batchResult.ownedIdCountAfter}ID</span>}</div><FocusedIncomeBreakdown comparison={batchResult.incomeComparison} focus={rewardFocus} /><BonusDeltaDetails delta={batchResult.bonusDelta} /><details className="batch-steps" open><summary>配置手順を見る（{batchResult.placedCount}人）</summary><ol>{batchResult.steps.map((step) => { const stepDelta = rewardFocus === "line" ? step.lineDelta : step.grossDelta; return <li key={step.candidateMemberId}><div><strong>{step.candidateName}</strong><span>→ {step.placementMemberName} 配下</span></div><small>タイトル {step.titleBefore} → {step.titleAfter} ・ 未達 {step.missingBefore} → {step.missingAfter} ・ {stepDelta >= 0 ? "+" : ""}{yen.format(stepDelta)}</small></li>; })}</ol></details><div className="result-action"><div><strong>この案を残す</strong><small>押したときだけ仮メンバーとして保存します</small></div><button className="secondary-button placement-save" disabled={savingBatch || batchResult.placedCount === 0} onClick={() => void addBatchPlacement()}>{savingBatch ? "試算組織へ一括追加中…" : `${batchResult.placedCount}人を試算組織へ追加`}</button></div><p className="warning">{batchResult.warnings.join(" / ")}</p></article></div>}

    <div className="results-list">{results.map((result) => <article className={`placement-card rank-${result.rank}`} key={result.placementMemberId}><div className="rank-badge">#{result.rank ?? "-"}</div><div className="placement-heading"><div><small>おすすめ配置</small><h2>{result.placementMemberName} 配下</h2></div><RewardAmount comparison={result.incomeComparison} focus={rewardFocus} /></div><div className="result-stats"><span>タイトル {result.titleBefore} → {result.titleAfter}</span><span>未達 {result.missingBefore} → {result.missingAfter}</span>{result.ownedIdCountAfter !== result.ownedIdCountBefore && <span>本人保有 {result.ownedIdCountBefore} → {result.ownedIdCountAfter}ID</span>}</div><FocusedIncomeBreakdown comparison={result.incomeComparison} focus={rewardFocus} /><BonusBreakdownDetails result={result} /><ul>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="result-action"><div><strong>この案を残す</strong><small>押したときだけ仮メンバーとして保存します</small></div><button className="secondary-button placement-save" disabled={!result.eligible || savingId !== null} onClick={() => void addPlacement(result)}>{savingId === result.placementMemberId ? "試算組織へ追加中…" : "この配置を試算組織へ追加"}</button></div><p className="warning">{result.warnings.join(" / ")}</p></article>)}</div>
  </>}</PageState>;
}

function RewardAmount({ comparison, focus }: { comparison: PlacementResult["incomeComparison"]; focus: RewardFocus }) {
  const delta = focus === "line" ? lineDeltaFor(comparison) : comparison.combined.grossDelta;
  const label = focus === "line" ? (comparison.mode === "pair" ? "2名合計・ライン差" : "継続ライン差") : (comparison.mode === "pair" ? "2名合計・登録月差" : "登録月の総額差");
  return <div className="placement-amount"><small>{label}</small><strong className={delta >= 0 ? "positive" : "negative"}>{delta >= 0 ? "+" : ""}{yen.format(delta)}</strong></div>;
}

function FocusedIncomeBreakdown({ comparison, focus }: { comparison: PlacementResult["incomeComparison"]; focus: RewardFocus }) {
  if (focus === "registration") return comparison.mode === "pair" ? <PairIncomeBreakdown comparison={comparison} focus={focus} /> : null;
  if (comparison.mode === "pair") return <PairIncomeBreakdown comparison={comparison} focus={focus} />;
  return <section className="line-income-focus"><div><strong>ラインボーナスのみ</strong><small>一時・ディレクター・タイトルボーナスを含みません</small></div><p><span>{yen.format(comparison.self.before.line)} → {yen.format(comparison.self.after.line)}</span><b className={comparison.self.delta.line >= 0 ? "positive" : "negative"}>{comparison.self.delta.line >= 0 ? "+" : ""}{yen.format(comparison.self.delta.line)}</b></p></section>;
}

function PairIncomeBreakdown({ comparison, focus = "registration" }: { comparison: PlacementResult["incomeComparison"]; focus?: RewardFocus }) {
  const owners = [comparison.self, comparison.partner].filter((owner): owner is NonNullable<typeof owner> => owner !== null);
  if (focus === "line") {
    const before = owners.reduce((sum, owner) => sum + owner.before.line, 0);
    const after = owners.reduce((sum, owner) => sum + owner.after.line, 0);
    return <section className="pair-income"><div className="pair-income-heading"><strong>2名のラインボーナス</strong><small>一時ボーナスを除外</small></div>{owners.map((owner) => <div className="pair-income-row" key={owner.memberId}><div><strong>{owner.memberName}</strong><small>ライン {yen.format(owner.before.line)} → {yen.format(owner.after.line)}</small></div><b className={owner.delta.line >= 0 ? "positive" : "negative"}>{owner.delta.line >= 0 ? "+" : ""}{yen.format(owner.delta.line)}</b></div>)}<div className="pair-income-total"><div><strong>2名合計</strong><small>ライン {yen.format(before)} → {yen.format(after)}</small></div><b className={after - before >= 0 ? "positive" : "negative"}>{after - before >= 0 ? "+" : ""}{yen.format(after - before)}</b></div></section>;
  }
  return <section className="pair-income"><div className="pair-income-heading"><strong>2名の収入内訳</strong><small>各人を個別計算して合算</small></div>{owners.map((owner) => <div className="pair-income-row" key={owner.memberId}><div><strong>{owner.memberName}</strong><small>総ボーナス {yen.format(owner.before.gross)} → {yen.format(owner.after.gross)}</small><small>概算振込 {yen.format(owner.before.estimatedNet)} → {yen.format(owner.after.estimatedNet)}</small></div><b className={owner.delta.gross >= 0 ? "positive" : "negative"}>{owner.delta.gross >= 0 ? "+" : ""}{yen.format(owner.delta.gross)}</b></div>)}<div className="pair-income-total"><div><strong>2名合計</strong><small>総ボーナス {yen.format(comparison.combined.beforeGross)} → {yen.format(comparison.combined.afterGross)}</small><small>概算振込 {yen.format(comparison.combined.beforeEstimatedNet)} → {yen.format(comparison.combined.afterEstimatedNet)}</small></div><b className={comparison.combined.grossDelta >= 0 ? "positive" : "negative"}>{comparison.combined.grossDelta >= 0 ? "+" : ""}{yen.format(comparison.combined.grossDelta)}</b></div></section>;
}

function BonusBreakdownDetails({ result }: { result: PlacementResult }) {
  return <BonusDeltaDetails delta={result.bonusDelta} />;
}

function BonusDeltaDetails({ delta }: { delta: PlacementResult["bonusDelta"] }) {
  return <details className="bonus-details"><summary><span>報酬内訳を見る</span><strong>{yen.format(delta.oneTime)} ＋ {yen.format(delta.recurring)}</strong></summary><div className="bonus-sections"><section><div className="bonus-section-heading"><strong>今回の登録時のみ</strong><span>{yen.format(delta.oneTime)}</span></div><p><span>スタートボーナス</span><b>{yen.format(delta.start)}</b></p><p><span>Aさん役（トレーナー）</span><b>{yen.format(delta.trainer)}</b></p><small>初回購入に対して発生</small></section><section><div className="bonus-section-heading"><strong>定期・追加購入が続く月</strong><span>{yen.format(delta.recurring)}</span></div><p><span>ラインボーナス</span><b>{yen.format(delta.line)}</b></p><p><span>ディレクターボーナス</span><b>{yen.format(delta.director)}</b></p><p><span>タイトルボーナス</span><b>{yen.format(delta.title)}</b></p><small>資格・定期購入・組織条件を満たす月の概算</small></section></div><div className="bonus-total"><span>概算振込額の変化<small>既存ボーナスの繰越解消を含む場合があります</small></span><strong>{yen.format(delta.estimatedNet)}</strong></div></details>;
}

function Forecast() {
  const tree = useLoad(api.tree, []); const tax = useLoad(api.tax, []); const saved = useLoad(api.savedForecasts, []);
  const [horizon, setHorizon] = useState(3); const [settings, setSettings] = useState(DEFAULT_FORECAST_SETTINGS);
  const [results, setResults] = useState<ForecastResult[]>([]); const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState(""); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const availableMembers = tree.data?.members.filter((member) => member.endedPeriod === null) ?? [];
  const rootTrainerCredential = tree.data?.members.find((member) => member.parentMemberId === null)?.trainerCredential ?? "NONE";
  const updateSetting = <K extends keyof ForecastSetting>(id: ForecastScenarioId, key: K, value: ForecastSetting[K]) => setSettings((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const buildScenarios = (): ForecastScenario[] => {
    if (!tree.data || !tax.data) return [];
    return FORECAST_IDS.map((id) => ({
      id, label: FORECAST_LABELS[id], taxProfile: tax.data ?? DEFAULT_TAX,
      months: Array.from({ length: horizon }, (_, index) => {
        const [year, month] = tree.data!.period.split("-").map(Number);
        const date = new Date(Date.UTC(year!, month! - 1 + index + 1, 1));
        const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,"0")}`;
        const setting = settings[id];
        return {
          period, registrations: [{ course: setting.course, placementMemberId: setting.placement, count: setting.direct, trainerBonusRole: setting.trainerBonusRole }],
          continuationRate: setting.retention / 100, additionalPv: setting.additionalPv,
          teamActivityRate: setting.teamActivity / 100, introductionsPerActiveMember: setting.introductionsPerActiveMember,
          maxTeamRegistrations: setting.maxTeamRegistrations
        };
      })
    }));
  };
  const run = async () => {
    if (!tree.data) return; const root = tree.data.members.find((member) => member.parentMemberId === null); if (!root) return;
    setBusy(true); setError(null); setMessage(null);
    try { setResults((await api.forecast({ period: tree.data.period, rootMemberId: root.id, scenarios: buildScenarios() })).results); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "試算できませんでした"); }
    finally { setBusy(false); }
  };
  const saveForecast = async () => {
    if (!tree.data || !results.length) return; const root = tree.data.members.find((member) => member.parentMemberId === null); if (!root) return;
    setBusy(true); setError(null);
    try {
      const name = saveName.trim() || `${tree.data.period}から${horizon}か月`;
      await api.saveForecast({ name, period: tree.data.period, rootMemberId: root.id, scenarios: buildScenarios() });
      setMessage(`「${name}」を保存しました`); setSaveName(""); saved.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存できませんでした"); }
    finally { setBusy(false); }
  };
  const loadForecast = (forecast: SavedForecast) => {
    const next = { ...DEFAULT_FORECAST_SETTINGS };
    for (const scenario of forecast.scenarios) {
      const month = scenario.months[0]; if (!month) continue; const registration = month.registrations[0];
      next[scenario.id] = {
        direct: registration?.count ?? 0, retention: Math.round(month.continuationRate * 100), course: registration?.course ?? "A",
        placement: registration?.placementMemberId ?? "root", additionalPv: month.additionalPv,
        trainerBonusRole: registration?.trainerBonusRole ?? null,
        teamActivity: Math.round(month.teamActivityRate * 100), introductionsPerActiveMember: month.introductionsPerActiveMember,
        maxTeamRegistrations: month.maxTeamRegistrations
      };
    }
    setSettings(next); setHorizon(forecast.scenarios[0]?.months.length ?? 3); setResults(forecast.results); setMessage(`「${forecast.name}」を表示しています`); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const removeForecast = async (forecast: SavedForecast) => {
    if (!window.confirm(`「${forecast.name}」を削除しますか？`)) return;
    try { await api.deleteForecast(forecast.id); setMessage(`「${forecast.name}」を削除しました`); saved.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "削除できませんでした"); }
  };
  const endValues = results.map((result) => result.months.at(-1)).filter((month): month is NonNullable<typeof month> => Boolean(month));
  const maxMembers = Math.max(...endValues.map((month) => month.groupMembers), 1);
  return <PageState loading={tree.loading || tax.loading || saved.loading} error={tree.error || tax.error || saved.error}>{tree.data && <><PageHeading kicker="FUTURE MAP" title="条件付き将来試算" description="悪い場合・現実ライン・目標ラインを同じ前提項目で比較します" />
    <section className="forecast-guidance"><strong>夢の数字にしないための見方</strong><p>「本人が紹介する人数」と「チームから生まれる人数」を分けています。チーム新規は、今月継続しているメンバーが翌月以降に紹介を増やす前提で計算します。</p></section>
    <section className="panel forecast-controls"><div className="segment">{[[3,"3か月"],[6,"6か月"],[12,"1年"]].map(([value,label]) => <button type="button" key={value} className={horizon === value ? "active" : ""} onClick={() => setHorizon(Number(value))}>{label}</button>)}</div><p className="input-note">各欄は毎月共通の前提です。月ごとの実績とずれたら保存案を更新せず、新しい案として残せます。</p><div className="scenario-inputs">{FORECAST_IDS.map((id) => { const setting = settings[id]; return <div className={`scenario-${id}`} key={id}><h3>{FORECAST_LABELS[id]}</h3><p>{id === "conservative" ? "想定どおり進まなかった場合" : id === "standard" ? "無理なく継続できる中心計画" : "達成したい上振れ目標"}</p><label>自分の紹介／月<input type="number" min="0" max="50" value={setting.direct} onChange={(event) => updateSetting(id, "direct", Number(event.target.value))} /></label><label>継続率<input type="number" min="0" max="100" value={setting.retention} onChange={(event) => updateSetting(id, "retention", Number(event.target.value))} />%</label><label>チーム活動率<input type="number" min="0" max="100" value={setting.teamActivity} onChange={(event) => updateSetting(id, "teamActivity", Number(event.target.value))} /><small className="field-note">継続者のうち紹介活動する割合</small></label><label>活動者1人の紹介数<input type="number" min="0" max="3" step="0.1" value={setting.introductionsPerActiveMember} onChange={(event) => updateSetting(id, "introductionsPerActiveMember", Number(event.target.value))} /></label><label>チーム新規の月上限<input type="number" min="0" max="50" value={setting.maxTeamRegistrations} onChange={(event) => updateSetting(id, "maxTeamRegistrations", Number(event.target.value))} /><small className="field-note">急な指数増加を抑える安全弁</small></label><label>コース<select value={setting.course} onChange={(event) => updateSetting(id, "course", event.target.value as CourseCode)}>{COURSES.map((item) => <option key={item}>{item}</option>)}</select></label><label>自分紹介の配置先<select value={setting.placement} onChange={(event) => updateSetting(id, "placement", event.target.value)}>{availableMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label>自分紹介のトレーナー担当<select value={setting.trainerBonusRole ?? ""} onChange={(event) => updateSetting(id, "trainerBonusRole", event.target.value ? event.target.value as TrainerBonusRole : null)}>{TRAINER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={!trainerRoleAvailable(rootTrainerCredential, option.value)}>{option.label}</option>)}</select><small className="field-note">資格に応じて初回購入月へ加算</small></label><label>本人追加p.v.／月<input type="number" min="0" value={setting.additionalPv} onChange={(event) => updateSetting(id, "additionalPv", Number(event.target.value))} /></label></div>; })}</div><button className="primary-button forecast-run" onClick={() => void run()} disabled={busy}>{busy ? "計算中…" : "3シナリオを比較"}</button></section>
    {error && <div className="state-card error">{error}</div>}{message && <p className="status-message">{message}</p>}
    {results.length > 0 && <><section className="panel forecast-comparison"><div className="panel-title"><h2>最終月の比較</h2><span className="status-chip">この前提なら</span></div>{results.map((result) => { const final = result.months.at(-1); if (!final) return null; const label = result.assumptionLoad === "low" ? "前提負荷 低" : result.assumptionLoad === "medium" ? "前提負荷 中" : "前提負荷 高"; return <div className="comparison-row" key={result.scenarioId}><div><strong>{FORECAST_LABELS[result.scenarioId]}</strong><small className={`assumption-${result.assumptionLoad}`}>{label}</small></div><div className="comparison-bar"><span style={{ width: `${Math.max(6, final.groupMembers / maxMembers * 100)}%` }} /></div><div><strong>{final.groupMembers}人・{final.title}</strong><small>{yen.format(final.gross)}／月 · 計{final.ownedIdCount}ID</small></div></div>; })}</section><div className="forecast-grid">{results.map((result) => <article className={`panel forecast-result scenario-${result.scenarioId}`} key={result.scenarioId}><div className="forecast-result-heading"><div><h2>{FORECAST_LABELS[result.scenarioId]}</h2><span className={`assumption-${result.assumptionLoad}`}>前提負荷 {result.assumptionLoad === "low" ? "低" : result.assumptionLoad === "medium" ? "中" : "高"}</span></div><details><summary>前提の確認</summary>{result.assumptionNotes.map((note) => <p key={note}>{note}</p>)}</details></div>{result.months.map((month) => <div className="forecast-row" key={month.period}><div><strong>{month.period}</strong><small>{month.title} · 組織{month.groupMembers}人 · 継続{month.retainedMembers}人</small><small>新規：本人{month.directRegistrations}人＋チーム{month.teamRegistrations}人 · 本人計{month.ownedIdCount}ID</small></div><div><strong>{number.format(month.groupPv)} p.v.</strong><small>総ボーナス {yen.format(month.gross)}（保有ID合算）</small><small>概算振込 {yen.format(month.estimatedNet)}</small></div></div>)}</article>)}</div><section className="panel forecast-save"><div><h2>この3案を保存</h2><p>入力前提と計算結果をセットで残します。</p></div><label>保存名<input maxLength={80} value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder={`${tree.data.period}から${horizon}か月`} /></label><button className="primary-button" disabled={busy} onClick={() => void saveForecast()}>保存する</button></section></>}
    <section className="panel saved-forecasts"><div className="panel-title"><h2>保存した将来試算</h2><span>{saved.data?.length ?? 0}件</span></div>{saved.data?.length ? saved.data.map((forecast) => <div className="saved-forecast-row" key={forecast.id}><button className="saved-forecast-open" onClick={() => loadForecast(forecast)}><strong>{forecast.name}</strong><small>{forecast.basePeriod}から{forecast.scenarios[0]?.months.length ?? 0}か月 · {new Date(forecast.updatedAt).toLocaleDateString("ja-JP")}</small></button><button className="text-button danger-text" onClick={() => void removeForecast(forecast)}>削除</button></div>) : <p className="muted">保存した試算はまだありません。</p>}</section><p className="disclaimer">これは入力した仮定に基づく条件付き試算です。将来の登録、継続、タイトル、報酬を保証しません。目標ラインだけでなく「想定より悪い」結果も行動計画に使ってください。</p>
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

function TitleReferenceCard({ title }: { title: TitleChecklistItem }) {
  return <details className={`title-reference-card ${title.status}`} open={title.status === "next"}><summary><span className="title-code">{title.code}</span><div><strong>{title.label}</strong><small>{title.conditions.filter((condition) => !condition.met).length}件の未達条件</small></div><div className="title-progress"><strong>{title.progress}%</strong><span>{title.status === "achieved" ? "達成圏" : title.status === "next" ? "次の目標" : "参考"}</span></div></summary><div className="title-reference-body"><TitleConditions conditions={title.conditions} />{title.alternatives && <section className="alternative-section"><h3>いずれかの取得パターンを達成</h3><div className="alternative-grid">{title.alternatives.map((alternative) => <div className={alternative.met ? "alternative-card met" : "alternative-card"} key={alternative.label}><div className="alternative-heading"><strong>{alternative.label}</strong><span>{alternative.met ? "達成" : "未達"}</span></div><TitleConditions conditions={alternative.conditions} /></div>)}</div></section>}</div></details>;
}

function TrainerReferenceCard({ item }: { item: TrainerQualificationChecklistItem }) {
  return <details className={`title-reference-card ${item.status}`} open={item.status === "next"}><summary><span className="title-code">{item.code}</span><div><strong>{item.label}</strong><small>{item.status === "achieved" ? "公式確認済み資格" : `トレーナー資格・${item.conditions.filter((condition) => !condition.met).length}件の未達条件`}</small></div><div className="title-progress"><strong>{item.progress}%</strong><span>{item.status === "achieved" ? "取得済み" : item.status === "next" ? "次の資格" : "参考"}</span></div></summary><div className="title-reference-body"><TitleConditions conditions={item.conditions} /><section className="alternative-section"><h3>初回購入1件あたりのトレーナーボーナス</h3><div className="alternative-grid">{item.bonuses.map((bonus) => <div className="alternative-card" key={bonus.courseLabel}><div className="alternative-heading"><strong>{bonus.courseLabel}コース</strong><span>{yen.format(bonus.solo)}</span></div>{bonus.withPreTrainer !== null && <small>Pトレーナーと同時担当時：{yen.format(bonus.withPreTrainer)}</small>}</div>)}</div></section></div></details>;
}

function TrainerProfileEditor({ initial, onSaved }: { initial: TrainerQualificationProfile; onSaved: () => void }) {
  const [profile, setProfile] = useState(initial); const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof TrainerQualificationProfile>(key: K, value: TrainerQualificationProfile[K]) => setProfile((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setMessage(null); try { await api.saveTrainerProfile(profile); setMessage("資格情報を保存しました"); onSaved(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "保存できませんでした"); } finally { setSaving(false); } };
  return <form className="panel form-grid" onSubmit={(event) => void save(event)}><div className="span-2"><p className="eyebrow">TRAINER PROFILE</p><h2>P・Sトレーナー条件の入力</h2><p>公式画面・受講記録を確認して入力してください。取得済み資格が、トレーナーボーナス試算の可否判定に使われます。</p></div><label>公式確認済み資格<select value={profile.trainerCredential} onChange={(event) => set("trainerCredential", event.target.value as TrainerQualificationProfile["trainerCredential"])}><option value="NONE">未取得</option><option value="PT">Pトレーナー</option><option value="ST">Sトレーナー</option></select></label><label>オープンスタジオ出席回数<input type="number" min="0" max="999" value={profile.openStudioAttendances} onChange={(event) => set("openStudioAttendances", Number(event.target.value))} /></label><label className="check-label"><input type="checkbox" checked={profile.sponsorLicense} onChange={(event) => set("sponsorLicense", event.target.checked)} />スポンサーライセンス取得済み</label><label className="check-label"><input type="checkbox" checked={profile.preTrainerCourseCompleted} onChange={(event) => set("preTrainerCourseCompleted", event.target.checked)} />Pトレーナー講習会受講済み</label><label className="check-label"><input type="checkbox" checked={profile.preTrainerKitPurchased} onChange={(event) => set("preTrainerKitPurchased", event.target.checked)} />Pトレーナーキット購入済み</label><label className="check-label"><input type="checkbox" checked={profile.startTrainerCourseCompleted} onChange={(event) => set("startTrainerCourseCompleted", event.target.checked)} />Sトレーナー講習会受講済み</label><label className="check-label"><input type="checkbox" checked={profile.startTrainerKitPurchased} onChange={(event) => set("startTrainerKitPurchased", event.target.checked)} />Sトレーナーキット購入済み</label><div className="form-actions span-2"><button className="primary-button" disabled={saving}>{saving ? "保存中…" : "資格情報を保存"}</button>{message && <span className="status-message">{message}</span>}</div></form>;
}

function TitleReference() {
  const { data, error, loading, reload } = useLoad(api.titleChecklists, []);
  const ld = data?.titles.find((title) => title.code === "LD");
  const laterTitles = data?.titles.filter((title) => title.code !== "LD") ?? [];
  return <PageState loading={loading} error={error}>{data && <>
    <PageHeading kicker="REFERENCE" title="全タイトル条件" description="現在の組織と実績で、各タイトルまでの不足を確認します" />
    <section className="panel title-reference-summary"><div><small>現在タイトル</small><strong>{data.achievedTitle === "NONE" ? "未取得" : data.achievedTitle}</strong></div><div><small>対象営業月</small><strong>{data.period}</strong></div><div><small>ルール設定版</small><strong>{data.planVersion}</strong></div></section>
    <TrainerProfileEditor key={JSON.stringify(data.trainerProfile)} initial={data.trainerProfile} onSaved={reload} />
    <div className="title-checklist">{ld && <TitleReferenceCard title={ld} />}{data.trainerQualifications.map((item) => <TrainerReferenceCard item={item} key={item.code} />)}{laterTitles.map((title) => <TitleReferenceCard title={title} key={title.code} />)}</div>
    <section className="panel source-panel"><h2>設定データの出典</h2>{data.sources.map((source) => <p key={`${source.name}-${source.revision}`}><strong>{source.name}</strong><span>{source.revision}・{source.pages}</span></p>)}</section>
    <p className="disclaimer">参考表示です。取得・維持の正式判定は最新の公式資料とフォーデイズ公式画面を優先してください。</p>
  </>}</PageState>;
}

function More() { return <><PageHeading kicker="TOOLS" title="その他" description="試算に使う設定とマスタ" /><div className="menu-grid"><NavLink to="/products"><span>▦</span><strong>商品マスタ</strong><small>価格・p.v.自動計算</small></NavLink><NavLink to="/imports"><span>⇩</span><strong>CSV取り込み</strong><small>会員・月次購入</small></NavLink><NavLink to="/settings"><span>⚙</span><strong>設定</strong><small>目標・概算条件</small></NavLink></div><section className="panel reference-tools"><p className="eyebrow">REFERENCE</p><h2>参考機能</h2><NavLink to="/reference/titles"><span>一覧</span><div><strong>全タイトル条件</strong><small>各タイトルの条件表と現在の不足を確認</small></div><b>›</b></NavLink></section><section className="panel about-card"><h2>このアプリについて</h2><p>組織、タイトル、報酬、配置、将来条件の試算を行う、非公式の個人用シミュレーターです。公式サイトへの自動ログイン、登録、購入は行いません。</p><p>人物・関係性・フォローの管理は「つながりカルテ」で行い、Navigatorには保存しません。将来連携する場合も、試算に必要な最小限のデータだけを受け取ります。</p></section></>; }

function PageHeading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>; }

export default function App() { return <Layout />; }
