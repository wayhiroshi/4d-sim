import { useId, useState } from "react";
import "./team-potential.css";

export default function TeamPotentialField({ value, minimum = 0, disabled = false, change }: {
  value: number | null | undefined; minimum?: number; disabled?: boolean; change: (value: number | null) => void;
}) {
  const id = useId();
  const [error, setError] = useState("");
  return <fieldset className="team-potential" disabled={disabled}>
    <legend>将来の配下ポテンシャル</legend>
    <p id={`${id}-help`}>本人を除く、配下全体の規模の目安。今すぐ加える人数ではありません。</p>
    <div className="potential-presets">{[100, 300, 500].map(n => <button type="button" key={n} disabled={n < minimum} aria-pressed={value === n} onClick={() => { setError(""); change(n); }}>{n} ID</button>)}<button type="button" aria-pressed={value == null} onClick={() => { setError(""); change(null); }}>未設定</button></div>
    <label htmlFor={id}>任意のID数（空欄＝未設定）</label>
    <input id={id} key={value ?? "unset"} type="number" inputMode="numeric" min={minimum} max={5000} step={1} placeholder="例：250" defaultValue={value ?? ""} aria-describedby={`${id}-help ${id}-note`} aria-invalid={!!error} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} onBlur={e => {
      const raw = e.target.value; const n = raw === "" ? null : Number(raw);
      if (e.target.validity.badInput || (n !== null && (!Number.isInteger(n) || n < minimum || n > 5000))) { setError(`${minimum}〜5,000の整数を入力してください`); return; }
      setError(""); if (n !== (value ?? null)) change(n);
    }}/>
    {error && <p role="alert">{error}</p>}
    <small id={`${id}-note`}>設定した紹介ペースで増え、この人数で追加を止めます。休止中のIDも含み、退会済みは除きます。未設定なら人数を制限しません（試算全体の処理上限は別）。</small>
  </fieldset>;
}
