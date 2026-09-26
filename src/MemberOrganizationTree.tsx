import { useMemo, useState } from "react";
import type { Member, OrganizationSnapshot } from "./shared/types";
import { descendantMemberIds } from "./domain/placement";
import { organizationTitles } from "./domain/organization-titles";
import "./member-organization.css";

export function downlineCount(snapshot: OrganizationSnapshot, memberId: string) {
  const ids = descendantMemberIds(snapshot.members, memberId);
  return snapshot.members.filter(m => m.id !== memberId && ids.has(m.id) && m.joinedPeriod <= snapshot.period && (m.endedPeriod === null || m.endedPeriod > snapshot.period)).length;
}

export default function MemberOrganizationTree({ snapshot, simulationIds, selectedId, onSelect }: {
  snapshot: OrganizationSnapshot; simulationIds: Set<string>; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const totals = useMemo(() => new Map(snapshot.members.map(m => [m.id, downlineCount(snapshot, m.id)])), [snapshot]);
  const titles = useMemo(() => organizationTitles(snapshot), [snapshot]);
  const parents = new Set(snapshot.members.map(m => m.parentMemberId).filter((id): id is string => !!id));
  function branch(member: Member, seen = new Set<string>()): React.ReactNode {
    if (seen.has(member.id)) return null;
    const children = snapshot.members.filter(m => m.parentMemberId === member.id);
    const open = !folded.has(member.id);
    const trial = simulationIds.has(member.id);
    const retired = member.endedPeriod !== null && member.endedPeriod <= snapshot.period;
    const title = titles.get(member.id)?.evaluation.achievedTitle ?? "NONE";
    const purchases = snapshot.purchases.filter(p => p.memberId === member.id && p.period === snapshot.period && p.status === "confirmed" && (!trial || p.kind !== "initial"));
    const pv = purchases.reduce((sum, p) => sum + p.pv * p.quantity, 0);
    const owner = snapshot.members.find(m => m.id === member.masterMemberId);
    const toggle = () => setFolded(current => { const next = new Set(current); if (open) next.add(member.id); else next.delete(member.id); return next; });
    return <li key={member.id}>
      <div className={`org-person${trial ? " is-trial" : ""}${selectedId === member.id ? " is-selected" : ""}`}>
        <button className="org-branch-button" type="button" disabled={!children.length} aria-expanded={children.length ? open : undefined} aria-controls={children.length ? `org-children-${member.id}` : undefined} aria-label={`${member.displayName}の配下を${open ? "収納" : "展開"}`} onClick={toggle}>
          <span className="org-chevron" aria-hidden="true">{children.length ? open ? "−" : "＋" : "·"}</span>
          <span><strong>{member.displayName} <em>({totals.get(member.id) ?? 0})</em></strong><small>{retired ? "退会済み" : member.idKind === "sub" ? `${owner?.displayName ?? "所有者"}のサブ` : member.parentMemberId === null ? "自分 · メイン" : "メンバー"}{trial ? " · 仮" : ""}</small></span>
        </button>
        <button className="org-detail-button" type="button" aria-label={`${member.displayName}の詳細・編集`} aria-pressed={selectedId === member.id} onClick={() => onSelect(member.id)}>詳細<span aria-hidden="true"> ›</span></button>
        <div className="org-person-meta"><span>{member.course}コース</span><span>{title === "NONE" ? "タイトル条件未達" : `${title}（試算）`}</span><span>{purchases.length ? `${pv.toLocaleString("ja-JP")} p.v.` : "当月p.v.未登録"}</span></div>
      </div>
      {children.length > 0 && open && <ul id={`org-children-${member.id}`}>{children.map(child => branch(child, new Set([...seen, member.id])))}</ul>}
    </li>;
  }
  return <section className="panel org-map" aria-label="現在の組織ツリー">
    <div className="org-map-heading"><h2>いまの配置</h2><div><button type="button" onClick={() => setFolded(new Set())}>すべて展開</button><button type="button" onClick={() => setFolded(new Set([...parents].filter(id => snapshot.members.find(m => m.id === id)?.parentMemberId !== null)))}>1段目だけ</button></div></div>
    <p className="org-map-help">名前の <b>(数字)</b> は本人を除く配下全体のID数。名前で枝を開閉、詳細で編集できます。</p>
    <ul className="org-roots">{snapshot.members.filter(m => m.parentMemberId === null).map(m => branch(m))}</ul>
    <p className="org-map-legend"><span>実メンバー</span><span>点線：仮メンバー</span><span>合計には仮・休止中を含み、退会済みは含みません。</span></p>
  </section>;
}
