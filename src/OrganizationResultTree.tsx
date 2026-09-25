import { useId, useState } from "react";
import type { StrategyNode } from "./shared/strategy";
import { organizationTree, type SummaryBranch } from "./domain/strategy-tree";
import "./organization-result-tree.css";

function Branch({ branch, level }: { branch: SummaryBranch; level: number }) {
  const { node, children, remaining } = branch;
  const [open, setOpen] = useState(level === 0 || (level === 1 && children.length > 0));
  const id = useId();
  const expandable = children.length > 0 || remaining > 0;
  const label = <><span className="result-tree-name">{node.name} <strong>({node.count.toLocaleString("ja-JP")})</strong></span><span className="result-tree-meta">{node.enrolled === false ? "退会済み・人数に含めません" : node.title === "NONE" ? "タイトル未取得" : node.title}{node.ownerId ? " · サブ" : ""}<span>稼働 {node.active.toLocaleString("ja-JP")} ID</span></span></>;
  return <li>
    {expandable ? <button type="button" className="result-tree-node" aria-expanded={open} aria-controls={id} aria-label={`${node.name}の配下 ${node.count} IDを${open ? "収納" : "展開"}`} onClick={() => setOpen(!open)}><span className="result-tree-toggle" aria-hidden="true">{open ? "−" : "＋"}</span><span>{label}</span></button>
      : <div className="result-tree-node"><span className="result-tree-toggle" aria-hidden="true">·</span><span>{label}</span></div>}
    {expandable && <ul id={id} hidden={!open}>
      {open && children.map(child => <Branch key={child.node.id} branch={child} level={level + 1}/>)}
      {open && remaining > 0 && <li className="result-tree-group"><span>その他の配下 <strong>({remaining.toLocaleString("ja-JP")})</strong></span><small>この枝に属するIDをまとめて表示</small></li>}
    </ul>}
  </li>;
}

export default function OrganizationResultTree({ nodes }: { nodes: StrategyNode[] }) {
  const { roots, detached } = organizationTree(nodes);
  return <div className="organization-result-tree">
    <p className="result-tree-legend">(数字) は本人を除く配下全体の合計ID数。休止中も含みます。名前を押すと展開・収納できます。</p>
    {nodes.length === 0 ? <p>この時点の組織はありません。</p> : <ul className="result-tree-roots" aria-label="試算結果の組織ツリー">{roots.map(root => <Branch key={root.node.id} branch={root} level={0}/>)}</ul>}
    {detached.length > 0 && <section className="result-tree-detached"><p>接続途中のIDが記録されていないチームです。再計算すると現在の形式で表示できます。</p><ul className="result-tree-roots">{detached.map(root => <Branch key={root.node.id} branch={root} level={0}/>)}</ul></section>}
  </div>;
}
