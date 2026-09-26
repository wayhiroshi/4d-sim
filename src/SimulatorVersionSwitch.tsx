import { useLocation } from "react-router-dom";
import "./simulator-version-switch.css";

/** Opening the other version must not unmount an unsaved simulation. */
export default function SimulatorVersionSwitch() {
  const { pathname } = useLocation();
  if (!["/", "/try", "/simulator"].includes(pathname)) return null;
  const versions = [
    { href: "/try", label: "シンプル版", description: "今回の画面 · 匿名サンプル" },
    { href: "/simulator", label: "詳細版", description: "元の画面 · Strategy Studio" },
  ];
  return <section className="simulator-version-switch" aria-label="試算のバージョン選択">
    <nav aria-label="試算画面を選ぶ">{versions.map(v => pathname === v.href
      ? <span key={v.href} className="version-choice current" aria-current="page"><strong>{v.label}<small>表示中</small></strong><span>{v.description}</span></span>
      : <a key={v.href} className="version-choice" href={v.href} target="_blank" rel="noopener noreferrer"><strong>{v.label}<small>別タブ ↗</small></strong><span>{v.description}</span></a>)}</nav>
    <p>別タブで開くので、今の試算は残ります。試算内容は引き継ぎません。</p>
  </section>;
}
